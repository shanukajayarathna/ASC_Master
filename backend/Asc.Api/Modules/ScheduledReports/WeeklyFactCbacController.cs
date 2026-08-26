using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>Staging area for the CBAC elevation-average TXT, on the Reports &gt; Automated
/// Reports page (see IWeeklyFactCbacStagingStore's own doc comment for why this can't be
/// database-derived like the WES side already is). Open to any signed-in user — stage this
/// whenever it arrives during the week, independent of when the sale itself closes;
/// WeeklyFactAutoReportJob picks it up on its own next tick once the sale has also closed.</summary>
[ApiController]
[Route("api/v1/admin/weekly-fact/cbac")]
[Authorize]
public class WeeklyFactCbacController(IWeeklyFactCbacStagingStore store) : ControllerBase
{
    [HttpGet]
    public ActionResult<List<StagedCbacDto>> List() =>
        Ok(store.ListStaged().Select(s => new StagedCbacDto(s.SaleYear, s.SaleNo, s.StagedAt)).OrderByDescending(s => s.StagedAt).ToList());

    [HttpPost]
    public async Task<IActionResult> Stage(StageCbacRequestDto dto, CancellationToken ct)
    {
        if (dto.SaleYear is < 2000 or > 2100) return BadRequest("Implausible sale year.");
        if (dto.SaleNo <= 0) return BadRequest("Sale number must be positive.");
        if (string.IsNullOrWhiteSpace(dto.TxtContent)) return BadRequest("TXT content is empty.");

        await store.StageAsync(dto.SaleYear, dto.SaleNo, dto.TxtContent, ct);
        return NoContent();
    }

    [HttpDelete("{saleYear:int}/{saleNo:int}")]
    public IActionResult Delete(int saleYear, int saleNo) =>
        store.Delete(saleYear, saleNo) ? NoContent() : NotFound();
}
