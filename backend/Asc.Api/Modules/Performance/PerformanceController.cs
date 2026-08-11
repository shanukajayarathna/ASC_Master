using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Performance;

/// <summary>Read-only cross-sale analytics — same gate as Analytics/Market (any
/// authenticated user), not an admin-only policy.</summary>
[ApiController]
[Route("api/v1/performance")]
[Authorize]
public class PerformanceController(PerformanceEngine engine) : ControllerBase
{
    [HttpGet("insights")]
    public async Task<ActionResult<List<PerformanceInsightDto>>> Insights(CancellationToken ct) =>
        Ok(await engine.AllInsights(ct));
}
