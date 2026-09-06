using System.Text.Json;
using Asc.Api.Models;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.ScheduledReports;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// ReportsAgent's tool surface: a curated subset of AssistantToolExecutor's data-lookup tools
/// (reused, never re-implemented — same pattern as AuctionToolExecutor) plus two genuinely new
/// tools over ISavedReportsService, which no existing agent tool reached even though the data
/// and its download route (ReportsController's "saved" endpoints) have existed since the
/// Scheduled Reports work. Read-only: it can generate a report's numbers on demand
/// (generate_report) and surface reports already produced (list_saved_reports/
/// get_saved_report), but never saves, edits, or deletes one — SaveAsync stays a job-only path.
/// </summary>
public class ReportsToolExecutor(AssistantToolExecutor generalTools, ISavedReportsService savedReports, ILogger<ReportsToolExecutor> logger)
{
    private const int MaxSavedReports = 25;
    private const int DefaultSavedReports = 10;

    private static readonly string[] ReusedToolNames =
    [
        "list_catalogues", "generate_report", "search_lots", "get_dashboard_stats", "get_breakdown",
    ];

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        .. AssistantToolExecutor.Definitions.Where(d => ReusedToolNames.Contains(d.Name)),
        new ToolDef(
            "list_saved_reports",
            "List reports that have already been generated and saved (e.g. by an automated weekly/monthly " +
            "job, or a user who saved one from the Reports page) — most recent first. Use this for " +
            "\"find me the report for...\"/\"what reports do we have\" questions, as distinct from " +
            "generate_report, which computes a fresh one from live catalogue data.",
            new
            {
                type = "object",
                properties = new
                {
                    type = new { type = "string", description = "Optional: only reports of this saved-report Type (e.g. 'weekly-fact', 'executive'). Omit to list every type." },
                    limit = new { type = "integer", description = $"How many to return. Default {DefaultSavedReports}, max {MaxSavedReports}." },
                },
            }),
        new ToolDef(
            "get_saved_report",
            "Fetch one saved report's own metadata by id (from list_saved_reports) — its title, type, " +
            "when it was created, and a download link if the actual file is available.",
            new
            {
                type = "object",
                properties = new
                {
                    id = new { type = "string", description = "The saved report's id, from list_saved_reports." },
                },
                required = new[] { "id" },
            }),
    ];

    public static IReadOnlyList<ToolDef> DefinitionsFor(bool isAdmin) =>
        isAdmin ? Definitions : [.. Definitions.Where(d => !d.RequiresAdmin)];

    public async Task<string> ExecuteAsync(string name, string argumentsJson, bool isAdmin, CancellationToken ct = default)
    {
        if (Definitions.All(d => d.Name != name))
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' is not available to the Reports Agent." });

        if (name is "list_saved_reports" or "get_saved_report")
        {
            logger.LogInformation("Reports tool call: {Tool} isAdmin={IsAdmin} args={Args}", name, isAdmin, argumentsJson);
            try
            {
                var args = AssistantToolExecutor.ParseArgs(argumentsJson);
                return name switch
                {
                    "list_saved_reports" => await ListSavedReports(
                        args["type"]?.GetValue<string>(),
                        Math.Clamp(args["limit"]?.GetValue<int>() ?? DefaultSavedReports, 1, MaxSavedReports),
                        ct),
                    "get_saved_report" => await GetSavedReport(Guid.Parse(args["id"]!.GetValue<string>()), ct),
                    _ => JsonSerializer.Serialize(new { error = $"Unknown tool '{name}'." }),
                };
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Reports tool call failed: {Tool} args={Args}", name, argumentsJson);
                return JsonSerializer.Serialize(new
                {
                    error = $"Tool '{name}' failed: {ex.Message}. If you used a placeholder or " +
                             "remembered id, call list_saved_reports first to get a real report id.",
                });
            }
        }

        // Every other advertised name is one of the reused tools — same implementation
        // GeneralAgent uses, including its own admin-gating, error-handling, and logging.
        return await generalTools.ExecuteAsync(name, argumentsJson, isAdmin, ct);
    }

    private async Task<string> ListSavedReports(string? type, int limit, CancellationToken ct)
    {
        var reports = type is null
            ? await savedReports.ListAllAsync(limit, ct)
            : await savedReports.ListByTypeAsync(type, limit, ct);

        return JsonSerializer.Serialize(new
        {
            rows = reports.Select(ToRow),
        });
    }

    private async Task<string> GetSavedReport(Guid id, CancellationToken ct)
    {
        var report = await savedReports.GetAsync(id, ct);
        return report is null
            ? JsonSerializer.Serialize(new { error = "No saved report with that id." })
            : JsonSerializer.Serialize(ToRow(report));
    }

    private static object ToRow(SavedReport r) => new
    {
        id = r.Id,
        type = r.Type,
        title = r.Title,
        catalogueId = r.CatalogueId,
        saleYear = r.SaleYear,
        saleNo = r.SaleNo,
        source = r.Source,
        createdAt = r.CreatedAt,
        notes = r.Notes,
        downloadUrl = r.StoredFileId.HasValue ? $"/api/v1/reports/saved/{r.Id}/download" : null,
    };
}
