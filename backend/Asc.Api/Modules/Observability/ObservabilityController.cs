using Asc.Api.Data;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Observability;

/// <summary>Read-only view over Modules/Observability's AiUsageLog collection — the "cost
/// control" half of Phase 8. Row count here is small enough (one row per AI Gateway call) that
/// aggregating in memory after a date-bounded fetch is simpler and just as fast as a Mongo
/// aggregation pipeline, matching the pattern AnalyticsController already uses for similar
/// group-by-provider/broker summaries.</summary>
[ApiController]
[Route("api/v1/admin/ai-usage")]
[Authorize(Policy = Policies.ViewObservability)]
public class ObservabilityController(MongoContext db) : ControllerBase
{
    [HttpGet("summary")]
    public async Task<ActionResult<List<AiUsageSummaryRowDto>>> Summary([FromQuery] int days = 7, CancellationToken ct = default)
    {
        var since = DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 90));
        var rows = await db.AiUsageLogs.Find(e => e.CreatedAt >= since).ToListAsync(ct);

        var summary = rows
            .GroupBy(e => (e.ProviderKey, e.Model))
            .Select(g => new AiUsageSummaryRowDto(
                g.Key.ProviderKey,
                g.Key.Model,
                g.Count(),
                g.Count(e => !e.Success),
                g.Sum(e => (long)e.PromptTokens),
                g.Sum(e => (long)e.CompletionTokens),
                g.Any(e => e.EstimatedCostUsd is not null) ? g.Sum(e => e.EstimatedCostUsd ?? 0) : null))
            .OrderByDescending(r => r.CallCount)
            .ToList();

        return Ok(summary);
    }
}
