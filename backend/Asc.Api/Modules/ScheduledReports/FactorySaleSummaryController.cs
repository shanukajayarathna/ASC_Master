using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.ScheduledReports;

public record GenerateFactorySaleSummaryRequestDto(int SaleYear, int SaleNo);

/// <summary>
/// The Factory Sale Summary report's own page under Reports — lets a user generate the
/// Estate-wise/Owner-wise workbook for a specific sale on demand, on top of
/// FactorySaleSummaryReportJob's own automatic generation after each sale closes. Open to any
/// signed-in user, same as the rest of the Reports area; downloading a listed output reuses
/// ReportsController's general GET /reports/saved/{id}/download.
/// </summary>
[ApiController]
[Route("api/v1/reports/factory-sale-summary")]
[Authorize]
public class FactorySaleSummaryController(FactorySaleSummaryReportJob job, ISavedReportsService savedReports) : ControllerBase
{
    [HttpPost("generate")]
    public async Task<ActionResult<SavedReportSummaryDto>> Generate(GenerateFactorySaleSummaryRequestDto dto, CancellationToken ct)
    {
        if (dto.SaleYear <= 0 || dto.SaleNo <= 0) return BadRequest("Sale year and sale number are both required.");

        Guid savedId;
        try
        {
            savedId = await job.GenerateForSaleAsync(dto.SaleYear, dto.SaleNo, ct);
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
