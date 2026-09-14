using System.IO.Compression;
using Asc.Api.Modules.ScheduledReports;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// The "Sharing Mark Catalogued Summary" report's own page under Reports. Manual-only —
/// see SharedMarkCatalogueGenerationService's own doc comment for why there is no
/// automatic trigger. Two ways to generate: from /data/sales if the sale is already
/// there, or from the 8 raw per-broker pre-sale catalogue files for a sale that hasn't
/// happened yet. Downloading a listed output reuses ReportsController's general
/// GET /reports/saved/{id}/download, same as every other report in this app.
/// </summary>
[ApiController]
[Route("api/v1/reports/shared-mark-catalogue-summary")]
[Authorize]
public class SharedMarkCatalogueController(
    SharedMarkCatalogueGenerationService generator,
    ISavedReportsService savedReports,
    CatalogueImportService importer,
    FactoryMarkPerformanceService performance) : ControllerBase
{
    public record GenerateFromSalesDataRequestDto(int SaleYear, int SaleNo);

    /// <summary>UnmatchedMarks: estate names that appear in the report but had no elevation
    /// history for their code anywhere on file — defaulted to "High & Medium Grown" with no
    /// way to confirm that's actually correct (see SharedMarkCatalogueService's own doc
    /// comment). Always empty for GenerateFromSalesData, since /data/sales lots already
    /// carry real elevation.</summary>
    public record GenerateResponseDto(List<SavedReportSummaryDto> Outputs, IReadOnlyList<string> UnmatchedMarks);

    [HttpPost("generate")]
    public async Task<ActionResult<GenerateResponseDto>> GenerateFromSalesData(GenerateFromSalesDataRequestDto dto, CancellationToken ct)
    {
        if (dto.SaleYear <= 0 || dto.SaleNo <= 0) return BadRequest("Sale year and sale number are both required.");

        GenerationResult result;
        try
        {
            result = await generator.GenerateForSaleAsync(dto.SaleYear, dto.SaleNo, ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        return await BuildResponseAsync(result, ct);
    }

    /// <summary>The primary path: all 8 broker files, one per required form field named
    /// "file_{BrokerCode}" (BrokerCode.All — ASC, EB, BC, JK, LC, MPB, FW, CT), plus
    /// SaleYear/SaleNo/SaleDate form fields. Every one of the 8 is required (confirmed with
    /// the user — partial generation isn't offered) since the report needs both ASC's own
    /// figures and every other broker's to know which estates are actually shared.</summary>
    [HttpPost("generate-from-upload")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<GenerateResponseDto>> GenerateFromUpload(
        [FromForm] int saleYear, [FromForm] int saleNo, [FromForm] DateTime saleDate, CancellationToken ct)
    {
        if (saleYear <= 0 || saleNo <= 0) return BadRequest("Sale year and sale number are both required.");

        var missing = BrokerCode.All.Where(code => Request.Form.Files.GetFile($"file_{code}") is null).ToList();
        if (missing.Count > 0)
            return BadRequest($"All 8 broker files are required. Missing: {string.Join(", ", missing)}.");

        var allLots = new List<Models.Lot>();
        foreach (var code in BrokerCode.All)
        {
            var file = Request.Form.Files.GetFile($"file_{code}")!;
            await using var stream = file.OpenReadStream();
            var rows = importer.ParseExcel(stream);
            var parsed = BrokerCatalogueUploadParser.Parse(code, importer, rows, saleNo);
            if (parsed.Lots.Count == 0) return BadRequest($"Couldn't read any lots from the {code} file — check it's the right file/format.");
            allLots.AddRange(parsed.Lots);
        }

        // Additive side-effect for Mark Intelligence's Comparison tab forward estimate: these
        // are exactly the raw pre-sale grade+weight facts that feature needs and has no other
        // way to see (FactoryMarkPerformanceService.SavePreSaleSnapshotAsync's own doc
        // comment). Captured regardless of whether report generation below succeeds, since the
        // underlying catalogue data is real either way.
        await performance.SavePreSaleSnapshotAsync(saleYear, saleNo, allLots, ct);

        GenerationResult result;
        try
        {
            result = await generator.GenerateFromUploadAsync(saleYear, saleNo, saleDate, allLots, ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        return await BuildResponseAsync(result, ct);
    }

    public record ParsePreviewResponseDto(List<string> Warnings);

    /// <summary>Dry-run for generate-from-upload: parses every broker file exactly as
    /// generation would, but never calls GenerateFromUploadAsync — nothing is saved. Lets the
    /// frontend show a "N rows will be skipped, continue anyway?" checkpoint before the real
    /// call commits a report built from data that looked off.</summary>
    [HttpPost("generate-from-upload/preview")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<ParsePreviewResponseDto>> PreviewFromUpload([FromForm] int saleYear, [FromForm] int saleNo, CancellationToken ct)
    {
        if (saleYear <= 0 || saleNo <= 0) return BadRequest("Sale year and sale number are both required.");

        var missing = BrokerCode.All.Where(code => Request.Form.Files.GetFile($"file_{code}") is null).ToList();
        if (missing.Count > 0)
            return BadRequest($"All 8 broker files are required. Missing: {string.Join(", ", missing)}.");

        var resultsByBroker = new Dictionary<string, BrokerParseResult>();
        foreach (var code in BrokerCode.All)
        {
            var file = Request.Form.Files.GetFile($"file_{code}")!;
            await using var stream = file.OpenReadStream();
            var rows = importer.ParseExcel(stream);
            resultsByBroker[code] = BrokerCatalogueUploadParser.Parse(code, importer, rows, saleNo);
        }
        return Ok(new ParsePreviewResponseDto(BuildParseWarnings(resultsByBroker)));
    }

    /// <summary>Same idea as generate-from-upload, but for a single zip file containing all
    /// 8 broker files instead of 8 separate form fields — the usual way these get shared
    /// around in practice. Each entry's broker is identified from its own content
    /// (BrokerCatalogueUploadParser.DetectBroker), not its filename: filenames vary
    /// unpredictably between sales (confirmed live: ASC's own file was
    /// "AScat362026xls.xls" for Sale 36 but "cat372026xls.xls" for Sale 37, with no "ASC"
    /// in the name at all), so a zip member's name can't be trusted to say which broker it
    /// is.</summary>
    [HttpPost("generate-from-zip")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<GenerateResponseDto>> GenerateFromZip(
        [FromForm] int saleYear, [FromForm] int saleNo, [FromForm] DateTime saleDate, IFormFile zipFile, CancellationToken ct)
    {
        if (saleYear <= 0 || saleNo <= 0) return BadRequest("Sale year and sale number are both required.");
        if (zipFile is null || zipFile.Length == 0) return BadRequest("A zip file is required.");

        var (rowsByBroker, unidentified, duplicates) = await ExtractZipEntriesAsync(zipFile, ct);

        if (unidentified.Count > 0)
            return BadRequest($"Couldn't identify the broker for: {string.Join(", ", unidentified)}. Check these are the right files.");
        if (duplicates.Count > 0)
            return BadRequest($"More than one file in the zip matched the same broker: {string.Join(", ", duplicates)}.");
        var missingFromZip = BrokerCode.All.Where(code => !rowsByBroker.ContainsKey(code)).ToList();
        if (missingFromZip.Count > 0)
            return BadRequest($"All 8 broker files are required. Missing from the zip: {string.Join(", ", missingFromZip)}.");

        var allLots = new List<Models.Lot>();
        foreach (var code in BrokerCode.All)
        {
            var parsed = BrokerCatalogueUploadParser.Parse(code, importer, rowsByBroker[code], saleNo);
            if (parsed.Lots.Count == 0) return BadRequest($"Couldn't read any lots from the {code} file — check it's the right file/format.");
            allLots.AddRange(parsed.Lots);
        }

        // Additive side-effect for Mark Intelligence's Comparison tab forward estimate: these
        // are exactly the raw pre-sale grade+weight facts that feature needs and has no other
        // way to see (FactoryMarkPerformanceService.SavePreSaleSnapshotAsync's own doc
        // comment). Captured regardless of whether report generation below succeeds, since the
        // underlying catalogue data is real either way.
        await performance.SavePreSaleSnapshotAsync(saleYear, saleNo, allLots, ct);

        GenerationResult result;
        try
        {
            result = await generator.GenerateFromUploadAsync(saleYear, saleNo, saleDate, allLots, ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        return await BuildResponseAsync(result, ct);
    }

    /// <summary>Dry-run for generate-from-zip — see PreviewFromUpload's own doc comment; same
    /// no-persist contract, just fed from a zip instead of 8 separate form fields.</summary>
    [HttpPost("generate-from-zip/preview")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<ParsePreviewResponseDto>> PreviewFromZip(
        [FromForm] int saleYear, [FromForm] int saleNo, IFormFile zipFile, CancellationToken ct)
    {
        if (saleYear <= 0 || saleNo <= 0) return BadRequest("Sale year and sale number are both required.");
        if (zipFile is null || zipFile.Length == 0) return BadRequest("A zip file is required.");

        var (rowsByBroker, unidentified, duplicates) = await ExtractZipEntriesAsync(zipFile, ct);

        if (unidentified.Count > 0)
            return BadRequest($"Couldn't identify the broker for: {string.Join(", ", unidentified)}. Check these are the right files.");
        if (duplicates.Count > 0)
            return BadRequest($"More than one file in the zip matched the same broker: {string.Join(", ", duplicates)}.");
        var missingFromZip = BrokerCode.All.Where(code => !rowsByBroker.ContainsKey(code)).ToList();
        if (missingFromZip.Count > 0)
            return BadRequest($"All 8 broker files are required. Missing from the zip: {string.Join(", ", missingFromZip)}.");

        var resultsByBroker = BrokerCode.All.ToDictionary(code => code, code => BrokerCatalogueUploadParser.Parse(code, importer, rowsByBroker[code], saleNo));
        return Ok(new ParsePreviewResponseDto(BuildParseWarnings(resultsByBroker)));
    }

    private static List<string> BuildParseWarnings(IReadOnlyDictionary<string, BrokerParseResult> resultsByBroker)
    {
        var warnings = new List<string>();
        foreach (var code in BrokerCode.All)
        {
            if (!resultsByBroker.TryGetValue(code, out var result)) continue;
            if (result.Lots.Count == 0) warnings.Add($"{code}: no lots could be read — check it's the right file/format.");
            else if (result.SkippedRows > 0) warnings.Add($"{code}: {result.SkippedRows} row(s) skipped (missing or invalid fields).");
        }
        return warnings;
    }

    public record DetectSaleInfoResponseDto(int? SaleYear, int? SaleNo, string? SaleDate, List<string> Warnings);

    /// <summary>Best-effort sale year/number/date read straight out of whichever broker
    /// files are already on hand — as few as one (a live guess while the user is still
    /// picking files individually) or all 8 in a zip. Most of the 8 files already carry
    /// this in their own data (see BrokerCatalogueUploadParser.TryDetectSaleInfo for which
    /// ones and how), so there's no reason to make the user type it in by hand when it's
    /// already sitting in the upload. Never required to succeed and never the final word —
    /// the caller's own form fields stay the source of truth for generation; this only ever
    /// supplies a starting guess, returning whatever partial answer it can (including all
    /// nulls) rather than an error when a field can't be determined.</summary>
    [HttpPost("detect-sale-info")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<DetectSaleInfoResponseDto>> DetectSaleInfo(CancellationToken ct)
    {
        Dictionary<string, List<List<string>>> rowsByBroker;

        var zipFile = Request.Form.Files.GetFile("zipFile");
        if (zipFile is { Length: > 0 })
        {
            (rowsByBroker, _, _) = await ExtractZipEntriesAsync(zipFile, ct);
        }
        else
        {
            rowsByBroker = new Dictionary<string, List<List<string>>>();
            foreach (var code in BrokerCode.All)
            {
                var file = Request.Form.Files.GetFile($"file_{code}");
                if (file is null) continue;
                await using var stream = file.OpenReadStream();
                rowsByBroker[code] = importer.ParseExcel(stream);
            }
        }

        var (year, saleNo, date, warnings) = BrokerCatalogueUploadParser.DetectSaleInfo(rowsByBroker, importer);
        return Ok(new DetectSaleInfoResponseDto(year, saleNo, date?.ToString("yyyy-MM-dd"), warnings));
    }

    /// <summary>Shared by generate-from-zip and detect-sale-info: walks every entry in the
    /// zip, skipping directories and anything that isn't a spreadsheet (folder entries,
    /// __MACOSX resource-fork junk, .DS_Store — all routine zip-of-a-folder noise), and
    /// identifies each one's broker from its own content (BrokerCatalogueUploadParser.
    /// DetectBroker), not its filename — filenames are inconsistent across sales (confirmed
    /// live: ASC's own file was "AScat362026xls.xls" for Sale 36 but "cat372026xls.xls" for
    /// Sale 37, with no "ASC" in the name at all).</summary>
    private async Task<(Dictionary<string, List<List<string>>> RowsByBroker, List<string> Unidentified, List<string> Duplicates)> ExtractZipEntriesAsync(
        IFormFile zipFile, CancellationToken ct)
    {
        var rowsByBroker = new Dictionary<string, List<List<string>>>();
        var unidentified = new List<string>();
        var duplicates = new List<string>();

        await using var zipStream = zipFile.OpenReadStream();
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            var ext = Path.GetExtension(entry.Name).ToLowerInvariant();
            if (ext != ".xls" && ext != ".xlsx") continue;

            await using var entryStream = entry.Open();
            using var buffered = new MemoryStream();
            await entryStream.CopyToAsync(buffered, ct);
            buffered.Position = 0;

            var rows = importer.ParseExcel(buffered);
            var brokerCode = BrokerCatalogueUploadParser.DetectBroker(rows);
            if (brokerCode is null)
            {
                unidentified.Add(entry.Name);
                continue;
            }
            if (!rowsByBroker.TryAdd(brokerCode, rows))
                duplicates.Add($"{brokerCode} (from \"{entry.Name}\")");
        }
        return (rowsByBroker, unidentified, duplicates);
    }

    [HttpGet("outputs")]
    public async Task<ActionResult<List<SavedReportSummaryDto>>> Outputs(CancellationToken ct)
    {
        var reports = await savedReports.ListByTypeAsync(SharedMarkCatalogueGenerationService.ReportType, 20, ct);
        return Ok(reports.Select(ToDto).ToList());
    }

    private async Task<ActionResult<GenerateResponseDto>> BuildResponseAsync(GenerationResult result, CancellationToken ct)
    {
        var dtos = new List<SavedReportSummaryDto>();
        foreach (var id in result.SavedReportIds)
        {
            var report = await savedReports.GetAsync(id, ct);
            if (report is not null) dtos.Add(ToDto(report));
        }
        return Ok(new GenerateResponseDto(dtos, result.UnmatchedMarks));
    }

    private static SavedReportSummaryDto ToDto(Models.SavedReport r) =>
        new(r.Id, r.Title, r.CreatedAt, r.Notes, r.StoredFileId.HasValue);
}
