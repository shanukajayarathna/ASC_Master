using System.Net.Http.Json;
using System.Text.Json;
using Asc.Api.Models;
using Asc.Api.Modules.Msl;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>Everything the internal Next.js route needs — mirrors WesEquivalentDto's own
/// shape field-for-field. Serialized/deserialized with explicit camelCase options (below):
/// unlike ASP.NET's MVC pipeline, a raw JsonContent.Create/ReadFromJsonAsync call defaults to
/// JsonSerializerOptions.Default, which is PascalCase and case-sensitive — the frontend side
/// (frontend/src/types/api.ts's WesEquivalentApi, and this route's own JSON body/response)
/// is plain camelCase TypeScript, so without this every field would silently fail to bind.</summary>
internal record GenerateRequest(int SaleYear, int SaleNo, string CbacTxtContent, WesEquivalentDto WesEquivalent);

// SaleDate is deliberately string, not DateTime: the frontend's own parseTxt produces a
// dd/mm/yyyy display string (see weeklyFactReport.ts), not ISO 8601 — and nothing here
// actually needs it as a real DateTime (the SavedReport title uses MslWeeklyReportService's
// own WesEquivalentDto.SaleDate instead, which is a real DateTime from MongoDB).
internal record GenerateResponse(bool Ok, string? Error, int? SaleNumber, string? SaleDate, List<string>? Warnings, string? ZipFileName, string? ZipBase64);

/// <summary>
/// Generates the Weekly FACT/RANK/LOW workbooks the moment a sale closes, with no admin
/// action needed — see the class-level doc comments on MslWeeklyReportService (the WES input)
/// and IWeeklyFactCbacStagingStore (the CBAC input) for why this needs two different sources
/// and why CBAC can't be database-derived. The actual TXT-parsing/ranking/Excel-template
/// pipeline is NOT reimplemented here: it stays in frontend/src/lib/weeklyFactReport.ts (a
/// line-for-line port of a Python tool with cell-diffed correctness fixes already paid for
/// once), called over an internal HTTP request to the Next.js server, which runs it in Node —
/// the exact same code the manual "Generate" button calls, just invoked headlessly instead of
/// from a browser click. PDFs are deliberately not produced by this path: the PDF builders
/// depend on a browser-canvas-only logo-loading helper (see worksheetPdf.ts's loadImage) with
/// no Node equivalent — the automated job saves the xlsx workbooks only, a disclosed, narrower
/// scope than the manual flow's full xlsx+pdf bundle.
/// </summary>
public class WeeklyFactAutoReportJob(
    MslWeeklyReportService wesService,
    IWeeklyFactCbacStagingStore cbacStore,
    IGeneratedReportFileStore fileStore,
    ISavedReportsService savedReports,
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    ILogger<WeeklyFactAutoReportJob> logger) : IScheduledReportJob
{
    /// <summary>Registered in Program.cs via AddHttpClient(HttpClientName, ...) — a named
    /// client rather than AddHttpClient&lt;WeeklyFactAutoReportJob&gt;() so this class's own
    /// DI lifetime stays a plain singleton (see Program.cs's own comment on this).</summary>
    public const string HttpClientName = "WeeklyFactInternal";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    // Sales past this age are almost certainly not going to get a CBAC upload at all
    // (someone should have staged it by now) — RunAsync starts surfacing those as a real
    // problem instead of a quiet "still waiting" once they cross it, mirroring
    // DeadlineEngine's own escalation-ladder philosophy for "how long is too long."
    private static readonly TimeSpan CbacGracePeriod = TimeSpan.FromHours(48);
    private static readonly TimeSpan LookbackWindow = TimeSpan.FromDays(21);

    public string Key => "weekly-fact-low";
    public string DisplayName => "Weekly FACT/RANK/LOW Report";
    public ReportJobTrigger Trigger => ReportJobTrigger.AfterSaleClose();

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var closedSales = await wesService.FindRecentlyClosedSalesAsync(LookbackWindow, ct);
        if (closedSales.Count == 0) return ScheduledReportJobRunResult.Ok("No sales closed in the lookback window.");

        var generated = new List<string>();
        var waiting = new List<string>();
        var failed = new List<string>();

        foreach (var (year, saleNo, saleDate) in closedSales)
        {
            if (await savedReports.ExistsForSaleAsync(Key, year, saleNo, ct)) continue;

            var cbacText = await cbacStore.GetAsync(year, saleNo, ct);
            if (cbacText is null)
            {
                var label = $"Sale {saleNo}/{year}";
                if (DateTime.UtcNow - saleDate > CbacGracePeriod)
                    failed.Add($"{label}: closed {DateTime.UtcNow - saleDate:d\\d\\ h\\h} ago, still no CBAC TXT staged.");
                else
                    waiting.Add(label);
                continue;
            }

            try
            {
                var savedId = await GenerateOneAsync(year, saleNo, cbacText, ct);
                generated.Add($"Sale {saleNo}/{year} (saved {savedId})");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Weekly FACT auto-generation failed for sale {SaleNo}/{Year}", saleNo, year);
                failed.Add($"Sale {saleNo}/{year}: {ex.Message}");
            }
        }

        var summary = string.Join(" ", new[]
        {
            generated.Count > 0 ? $"Generated: {string.Join(", ", generated)}." : null,
            waiting.Count > 0 ? $"Waiting on CBAC: {string.Join(", ", waiting)}." : null,
            failed.Count > 0 ? $"Needs attention: {string.Join(", ", failed)}." : null,
        }.Where(s => s is not null));

        if (failed.Count > 0 && generated.Count == 0) return ScheduledReportJobRunResult.Failed(summary);
        return ScheduledReportJobRunResult.Ok(summary.Length > 0 ? summary : "Nothing new to generate.");
    }

    private async Task<Guid> GenerateOneAsync(int year, int saleNo, string cbacText, CancellationToken ct)
    {
        var wes = await wesService.BuildAsync(year, saleNo, ct)
            ?? throw new InvalidOperationException("Sale disappeared from the MSL archive between the closed-sales scan and generation.");

        var secret = config["WeeklyFact:InternalJobSecret"]
            ?? throw new InvalidOperationException("WeeklyFact:InternalJobSecret is not configured — set it via dotnet user-secrets, matching the frontend's INTERNAL_JOB_SECRET.");

        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/internal/weekly-fact/generate");
        req.Headers.Add("x-internal-job-secret", secret);
        req.Content = JsonContent.Create(new GenerateRequest(year, saleNo, cbacText, wes), options: JsonOptions);

        using var http = httpClientFactory.CreateClient(HttpClientName);
        using var res = await http.SendAsync(req, ct);
        var body = await res.Content.ReadFromJsonAsync<GenerateResponse>(JsonOptions, ct)
            ?? throw new InvalidOperationException("Internal report-generation endpoint returned an empty response.");

        if (!res.IsSuccessStatusCode || !body.Ok)
            throw new InvalidOperationException(body.Error ?? $"Internal report-generation endpoint returned HTTP {(int)res.StatusCode}.");

        var zipBytes = Convert.FromBase64String(body.ZipBase64 ?? throw new InvalidOperationException("Response had no zip content."));
        var fileName = body.ZipFileName ?? $"weekly_reports_sale{saleNo}_{year}.zip";
        using var zipStream = new MemoryStream(zipBytes);
        var storedFileId = await fileStore.SaveAsync(zipStream, fileName, "application/zip", ct);

        var report = await savedReports.SaveAsync(new SavedReport
        {
            Type = Key,
            Title = $"Weekly FACT/RANK/LOW — Sale {saleNo}/{year} ({wes.SaleDate:dd MMM yyyy})",
            SaleYear = year,
            SaleNo = saleNo,
            StoredFileId = storedFileId,
            Source = "Generated automatically on sale close",
        }, ct);

        if (body.Warnings is { Count: > 0 })
            logger.LogWarning("Weekly FACT auto-generation for sale {SaleNo}/{Year} completed with warnings: {Warnings}",
                saleNo, year, string.Join("; ", body.Warnings));

        return report.Id;
    }
}
