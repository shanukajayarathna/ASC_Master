using Asc.Api.Modules.ScheduledReports;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.CategoryReports;

/// <summary>
/// The Category Analysis report's own page under Reports — lets a user preview and generate the
/// "Price & Classification, Sale x Broker" workbook for any Category value (e.g. "Ex-estate")
/// across any set of sales, on top of EstateCategoryReportJob's own automatic generation after
/// each sale closes. Open to any signed-in user, same as the rest of the Reports area;
/// downloading a listed output reuses ReportsController's general GET /reports/saved/{id}/download.
/// </summary>
[ApiController]
[Route("api/v1/reports/category-analysis")]
[Authorize]
public class CategoryReportsController(ICatalogueSource source, EstateCategoryReportJob job, ISavedReportsService savedReports) : ControllerBase
{
    /// <summary>Category values seen in the most recently imported catalogue — representative
    /// enough for the picker without scanning every sale on every page load (categories are a
    /// fixed set of section names that don't vary week to week).</summary>
    [HttpGet("categories")]
    public ActionResult<List<CategoryOptionDto>> Categories()
    {
        var latest = source.ListCatalogues().FirstOrDefault();
        if (latest is null) return Ok(new List<CategoryOptionDto>());
        var lots = source.GetLots(latest.Id);
        return Ok(lots is null ? [] : CategoryAnalysisEngine.CategoryOptions(lots));
    }

    /// <summary>Live preview (not saved) for the report page's on-screen tables — the same
    /// computation the workbook uses, returned as JSON.</summary>
    [HttpGet("preview")]
    public ActionResult<CategoryAnalysisDto> Preview([FromQuery] string category, [FromQuery] List<Guid> catalogueIds)
    {
        if (string.IsNullOrWhiteSpace(category)) return BadRequest("A category is required.");
        if (catalogueIds is null || catalogueIds.Count == 0) return BadRequest("At least one sale must be selected.");

        var lots = new List<Models.Lot>();
        foreach (var id in catalogueIds)
        {
            var catalogueLots = source.GetLots(id);
            if (catalogueLots is not null) lots.AddRange(catalogueLots);
        }
        if (lots.Count == 0) return NotFound("None of the selected sales could be loaded.");

        return Ok(CategoryAnalysisEngine.Build(lots, category));
    }

    [HttpPost("generate")]
    public async Task<ActionResult<SavedReportSummaryDto>> Generate(GenerateCategoryAnalysisRequestDto dto, CancellationToken ct)
    {
        Guid savedId;
        try
        {
            savedId = await job.GenerateAsync(dto.Category, dto.CatalogueIds, "Generated manually", ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        var report = await savedReports.GetAsync(savedId, ct);
        if (report is null) return NotFound();
        return Ok(new SavedReportSummaryDto(report.Id, report.Title, report.CreatedAt, report.Notes, report.StoredFileId.HasValue));
    }

    [HttpGet("outputs")]
    public async Task<ActionResult<List<SavedReportSummaryDto>>> Outputs(CancellationToken ct)
    {
        var reports = await savedReports.ListByTypeAsync(job.Key, 20, ct);
        return Ok(reports.Select(r => new SavedReportSummaryDto(r.Id, r.Title, r.CreatedAt, r.Notes, r.StoredFileId.HasValue)).ToList());
    }
}
