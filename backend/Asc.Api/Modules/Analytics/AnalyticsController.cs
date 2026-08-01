using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Reports;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Analytics;

/// <summary>
/// Ports the original vanilla-JS Analysis module (js/analysis.js) — same 5 sections, moved
/// to server-side aggregation as that stub's own description promised. Group Breakdown and
/// Classification Distribution reuse Modules/Reports/ReportGenerator.cs's aggregation
/// directly rather than re-deriving it.
/// </summary>
[ApiController]
[Route("api/v1/analytics")]
[Authorize]
public class AnalyticsController(ICatalogueSource source, MongoContext db) : ControllerBase
{
    private static readonly Dictionary<string, (string Label, Func<Lot, string?> Selector)> BreakdownColumns = new()
    {
        ["broker"] = ("Broker", l => l.Broker),
        ["grade"] = ("Grade", l => l.Grade),
        ["category"] = ("Category", l => l.Category),
        ["garden"] = ("Garden", l => l.Garden),
        ["elevation"] = ("Elevation", l => l.Elevation),
        ["region"] = ("Region", l => l.Region),
        ["warehouse"] = ("Warehouse", l => l.Warehouse),
        ["saleNo"] = ("Sale No", l => l.SaleNo),
    };

    [HttpGet("{catalogueId:guid}/overview")]
    public async Task<ActionResult<OverviewStatsDto>> Overview(Guid catalogueId, CancellationToken ct)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return NotFound();
        return Ok(ComputeOverview(merged));
    }

    [HttpGet("{catalogueId:guid}/breakdown/{column}")]
    public async Task<ActionResult<List<GroupRowDto>>> Breakdown(Guid catalogueId, string column, CancellationToken ct)
    {
        if (!BreakdownColumns.TryGetValue(column, out var def))
            return BadRequest($"Unknown breakdown column '{column}'.");
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return NotFound();
        return Ok(ReportGenerator.GroupSection(def.Label, def.Label, merged, def.Selector).Groups);
    }

    [HttpGet("{catalogueId:guid}/distribution")]
    public async Task<ActionResult<List<GroupRowDto>>> Distribution(Guid catalogueId, CancellationToken ct)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return NotFound();
        return Ok(ReportGenerator.ClassificationSection(merged).Groups);
    }

    [HttpGet("{catalogueId:guid}/top-bottom")]
    public async Task<ActionResult<List<TopBottomLotDto>>> TopBottom(
        Guid catalogueId, CancellationToken ct, [FromQuery] string mode = "top", [FromQuery] int n = 15)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return NotFound();

        var valued = merged.Where(x => x.Val?.EffectiveValue != null);
        var ordered = mode == "bottom"
            ? valued.OrderBy(x => x.Val!.EffectiveValue)
            : valued.OrderByDescending(x => x.Val!.EffectiveValue);

        var rows = ordered.Take(Math.Clamp(n, 1, 100))
            .Select(x => new TopBottomLotDto(x.Lot.Id, x.Lot.LotNumber, x.Lot.Broker, x.Lot.Grade, x.Val!.EffectiveValue))
            .ToList();
        return Ok(rows);
    }

    [HttpGet("{catalogueId:guid}/quality")]
    public async Task<ActionResult<DataQualityDto>> Quality(Guid catalogueId, CancellationToken ct)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return NotFound();

        var missing = merged.Count(x => x.Val?.EffectiveValue is null);

        // A record counts as incomplete once 30%+ of these 10 fields are blank — same
        // threshold the original vanilla-JS Analysis module used.
        var incomplete = merged.Count(x =>
        {
            var l = x.Lot;
            string?[] fields =
            [
                l.Broker, l.Grade, l.Garden, l.Category, l.Elevation, l.Region, l.Warehouse, l.SaleNo,
                l.NetWeight?.ToString(), l.GrossWeight?.ToString(),
            ];
            return fields.Count(string.IsNullOrWhiteSpace) / (double)fields.Length >= 0.3;
        });

        // Lot numbers legitimately restart per broker within one sale (e.g. two different
        // brokers both listing a "Lot 1"), so raw LotNumber collisions aren't a data-quality
        // signal — confirmed against real data during verification. RowKey (lot number +
        // invoice, per its own doc comment on Lot.cs) is this app's actual identity key
        // elsewhere, so a genuine duplicate is a repeated RowKey.
        var duplicateLots = merged
            .Where(x => !string.IsNullOrWhiteSpace(x.Lot.RowKey))
            .GroupBy(x => x.Lot.RowKey)
            .Count(g => g.Count() > 1);

        var values = merged.Where(x => x.Val?.EffectiveValue != null).Select(x => x.Val!.EffectiveValue!.Value).OrderBy(v => v).ToList();
        var q1 = Quartile(values, 0.25);
        var q3 = Quartile(values, 0.75);
        var outliers = 0;
        if (q1.HasValue && q3.HasValue)
        {
            var iqr = q3.Value - q1.Value;
            var (lower, upper) = (q1.Value - 1.5m * iqr, q3.Value + 1.5m * iqr);
            outliers = values.Count(v => v < lower || v > upper);
        }

        return Ok(new DataQualityDto(missing, incomplete, duplicateLots, outliers));
    }

    private async Task<List<(Lot Lot, Valuation? Val)>?> LoadMerged(Guid catalogueId, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return null;
        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct))
            .ToDictionary(v => v.LotId, v => v.Valuation);
        return lots.Select(l => (Lot: l, Val: LotsController.Merged(l, overrides))).ToList();
    }

    private static OverviewStatsDto ComputeOverview(List<(Lot Lot, Valuation? Val)> merged)
    {
        var values = merged.Where(x => x.Val?.EffectiveValue != null).Select(x => x.Val!.EffectiveValue!.Value).OrderBy(v => v).ToList();
        if (values.Count == 0) return new OverviewStatsDto(null, null, null, null, null, null, null, null);

        var mean = values.Average();
        var median = values.Count % 2 == 1 ? values[values.Count / 2] : (values[values.Count / 2 - 1] + values[values.Count / 2]) / 2;
        var mode = values.GroupBy(v => v).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).First().Key;

        // Population variance/std dev — this describes the complete valued-lot set for the
        // catalogue, not a sample drawn from some larger population.
        var variance = values.Sum(v => (v - mean) * (v - mean)) / values.Count;
        var stdDev = (decimal)Math.Sqrt((double)variance);

        var q1 = Quartile(values, 0.25);
        var q3 = Quartile(values, 0.75);
        var spread = q1.HasValue && q3.HasValue ? q3 - q1 : null;

        return new OverviewStatsDto(mean, median, mode, stdDev, variance, q1, q3, spread);
    }

    /// <summary>Nearest-rank quartile — a simple, deterministic choice for a summary stat,
    /// not a scientific percentile engine.</summary>
    private static decimal? Quartile(List<decimal> sorted, double p)
    {
        if (sorted.Count == 0) return null;
        var index = (int)Math.Ceiling(p * sorted.Count) - 1;
        return sorted[Math.Clamp(index, 0, sorted.Count - 1)];
    }
}
