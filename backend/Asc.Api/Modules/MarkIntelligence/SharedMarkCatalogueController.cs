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
    CatalogueImportService importer) : ControllerBase
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
            var lots = BrokerCatalogueUploadParser.Parse(code, importer, rows, saleNo);
            if (lots.Count == 0) return BadRequest($"Couldn't read any lots from the {code} file — check it's the right file/format.");
            allLots.AddRange(lots);
        }

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
