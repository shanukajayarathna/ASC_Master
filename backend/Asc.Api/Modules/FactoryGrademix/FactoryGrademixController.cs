using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.FactoryGrademix;

/// <summary>
/// Reports > Factory Grademix — shown to a factory owner across the table. Open to any signed-in
/// user, same as the rest of the Reports area. All figures come from the weekly sale files and
/// the Tea Board monthly averages; see FactoryGrademixService.
/// </summary>
[ApiController]
[Route("api/v1/reports/factory-grademix")]
[Authorize]
public class FactoryGrademixController(FactoryGrademixService service) : ControllerBase
{
    [HttpGet("sales")]
    public ActionResult<IReadOnlyList<FactoryGrademixSaleDto>> Sales() => Ok(service.ListSales());

    [HttpGet("factories")]
    public async Task<ActionResult<IReadOnlyList<FactoryOptionDto>>> Factories([FromQuery] string? q, CancellationToken ct) =>
        Ok(await service.SearchFactoriesAsync(q, ct));

    [HttpGet("compare")]
    public async Task<ActionResult<IReadOnlyList<CompareFactoryDto>>> Compare(
        [FromQuery] List<string> codes, [FromQuery] int? year, [FromQuery] int? saleNo, [FromQuery] int months = 6, CancellationToken ct = default)
    {
        if (codes.Count == 0) return BadRequest("Pick at least one factory to compare.");
        return Ok(await service.CompareAsync(codes, year, saleNo, months, ct));
    }

    [HttpGet("{code}")]
    public async Task<ActionResult<FactoryGrademixReportDto>> Report(
        string code, [FromQuery] int? year, [FromQuery] int? saleNo, [FromQuery] int months = 6, CancellationToken ct = default)
    {
        var report = await service.GetReportAsync(code, year, saleNo, months, ct);
        return report is null
            ? NotFound("No sold lots for this factory in that sale — pick another sale or factory.")
            : Ok(report);
    }
}
