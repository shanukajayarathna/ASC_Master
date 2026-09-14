using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Msl;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Factory & Mark performance — the "Comparison" tab in Mark Intelligence. Reading needs no
/// special policy (any authenticated user — same convention as MarkIntelligenceController's
/// browse endpoints); triggering the historical backfill is Admin-only
/// (Policies.ManageMarkIntelligence), same as MarkIntelligenceController's own "mine" trigger.
/// All reads/writes go through FactoryMarkPerformanceService/FactoryMarkPerformanceMiningService
/// — no direct Mongo access here.
/// </summary>
[ApiController]
[Route("api/v1/mark-intelligence/factory-mark-performance")]
[Authorize]
public class FactoryMarkPerformanceController(
    FactoryMarkPerformanceService performance,
    FactoryMarkPerformanceMiningService mining,
    MslWeeklyReportService wesService,
    IAuditLogger audit) : ControllerBase
{
    [HttpGet("factories/search")]
    public async Task<ActionResult<List<FactorySearchResultDto>>> SearchFactories([FromQuery] string q, CancellationToken ct) =>
        Ok(await performance.SearchFactoriesAsync(q, ct));

    [HttpGet("factories/{code}")]
    public async Task<ActionResult<FactoryMarkPerformanceSummaryDto>> GetFactoryPerformance(
        string code, [FromQuery] int fromYear, [FromQuery] int fromSaleNo, [FromQuery] int toYear, [FromQuery] int toSaleNo, CancellationToken ct)
    {
        if (!ValidRange(fromYear, fromSaleNo, toYear, toSaleNo, out var error)) return BadRequest(error);
        return Ok(await performance.GetFactoryPerformanceAsync(code, fromYear, fromSaleNo, toYear, toSaleNo, ct));
    }

    [HttpGet("marks/{code}")]
    public async Task<ActionResult<FactoryMarkPerformanceSummaryDto>> GetMarkPerformance(
        string code, [FromQuery] int fromYear, [FromQuery] int fromSaleNo, [FromQuery] int toYear, [FromQuery] int toSaleNo, CancellationToken ct)
    {
        if (!ValidRange(fromYear, fromSaleNo, toYear, toSaleNo, out var error)) return BadRequest(error);
        return Ok(await performance.GetMarkPerformanceAsync(code, fromYear, fromSaleNo, toYear, toSaleNo, ct));
    }

    /// <summary>codes are either all factory codes or all mark codes (isFactory) — comparison
    /// never mixes the two. Capped at MaxCompareCodes; the service itself has no cap logic of
    /// its own, per explicit instruction that comparison isn't a separate feature.</summary>
    [HttpGet("compare")]
    public async Task<ActionResult<List<FactoryMarkPerformanceSummaryDto>>> Compare(
        [FromQuery] List<string> codes, [FromQuery] bool isFactory,
        [FromQuery] int fromYear, [FromQuery] int fromSaleNo, [FromQuery] int toYear, [FromQuery] int toSaleNo, CancellationToken ct)
    {
        if (!ValidRange(fromYear, fromSaleNo, toYear, toSaleNo, out var error)) return BadRequest(error);
        if (codes.Count == 0) return BadRequest("At least one code is required.");
        if (codes.Count > FactoryMarkPerformanceService.MaxCompareCodes)
            return BadRequest($"At most {FactoryMarkPerformanceService.MaxCompareCodes} can be compared at once.");

        var results = await performance.CompareFactoryOrMarkPerformanceAsync(codes, isFactory, fromYear, fromSaleNo, toYear, toSaleNo, ct);
        return Ok(results.ToList());
    }

    [HttpGet("forward-estimate/{code}")]
    public async Task<ActionResult<ForwardEstimateSummaryDto>> ForwardEstimate(string code, [FromQuery] bool isFactory, CancellationToken ct) =>
        Ok(await performance.GetForwardEstimateAsync(code, isFactory, ct));

    /// <summary>Manual-trigger initial historical backfill — mirrors
    /// MarkIntelligenceController.RunMining's own shape. Bounded to the last `days` (default
    /// ~2 years), per the discovery-phase decision to backfill a recent window first and
    /// extend it later rather than mining the full 2013-present archive up front.</summary>
    [HttpPost("backfill")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<ActionResult<BackfillResultDto>> Backfill([FromQuery] int days = 730, CancellationToken ct = default)
    {
        if (days <= 0) return BadRequest("days must be positive.");

        var closedSales = await wesService.FindRecentlyClosedSalesAsync(TimeSpan.FromDays(days), ct);
        var periods = closedSales.Select(s => (s.Year, s.SaleNo)).ToList();
        var results = await mining.MineForSalesAsync(periods, ct);

        var result = new BackfillResultDto(
            PeriodsFound: periods.Count,
            PeriodsMined: results.Count,
            MarkFactsWritten: results.Sum(r => r.MarkFactsWritten),
            FactoryFactsWritten: results.Sum(r => r.FactoryFactsWritten));

        await audit.LogAsync(User, "MarkIntelligence.FactoryMarkPerformanceBackfill",
            details: $"{result.PeriodsMined} periods mined over {days} days: {result.MarkFactsWritten} mark facts, {result.FactoryFactsWritten} factory facts.", ct: ct);

        return Ok(result);
    }

    private static bool ValidRange(int fromYear, int fromSaleNo, int toYear, int toSaleNo, out string? error)
    {
        if (fromYear * 100 + fromSaleNo <= toYear * 100 + toSaleNo)
        {
            error = null;
            return true;
        }
        error = "fromYear/fromSaleNo must not be after toYear/toSaleNo.";
        return false;
    }
}
