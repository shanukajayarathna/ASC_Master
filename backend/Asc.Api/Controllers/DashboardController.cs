using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

[ApiController]
[Route("api/catalogues/{catalogueId:guid}/dashboard")]
public class DashboardController(ICatalogueSource source, MongoContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<DashboardStatsDto>> Get(Guid catalogueId)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null || lots.Count == 0)
            return Ok(new DashboardStatsDto(0, 0, 0, 0, null, null, null, null, null, null, null, null, null, null, null, null));

        // User-entered valuations override the file-derived ones lot by lot.
        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync())
            .ToDictionary(v => v.LotId, v => v.Valuation);
        var merged = lots.Select(l => (Lot: l, Val: overrides.TryGetValue(l.Id, out var ov) ? ov : l.Valuation)).ToList();

        var total = merged.Count;

        bool IsComplete((Lot Lot, Valuation? Val) x) => x.Val is not null &&
            (x.Val.ValuationSingle != null || x.Val.ValuationFrom != null) &&
            !string.IsNullOrEmpty(x.Val.StandardData) && !string.IsNullOrEmpty(x.Val.LiquorRemarks);

        var completed = merged.Count(IsComplete);
        var pending = total - completed;

        var today = DateTime.UtcNow.Date;
        var todayCount = merged.Count(x => x.Val != null && x.Val.UpdatedAt.Date == today);

        var values = merged.Where(x => x.Val?.EffectiveValue != null).Select(x => x.Val!.EffectiveValue!.Value).ToList();

        var rangeWidths = merged
            .Where(x => x.Val is { ValuationFrom: not null, ValuationTo: not null })
            .Select(x => x.Val!.ValuationTo!.Value - x.Val.ValuationFrom!.Value)
            .ToList();

        string? MostCommon(Func<Lot, string?> selector) =>
            merged.Select(x => selector(x.Lot)).Where(v => !string.IsNullOrEmpty(v))
                .GroupBy(v => v).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();

        var totalNetLots = merged.Where(x => x.Lot.NetWeight != null).ToList();
        var totalGrossLots = merged.Where(x => x.Lot.GrossWeight != null).ToList();

        return Ok(new DashboardStatsDto(
            total, completed, pending, todayCount,
            values.Count > 0 ? values.Average() : null,
            values.Count > 0 ? values.Max() : null,
            values.Count > 0 ? values.Min() : null,
            rangeWidths.Count > 0 ? rangeWidths.Average() : null,
            MostCommon(l => l.Broker), MostCommon(l => l.Grade), MostCommon(l => l.Category), MostCommon(l => l.Elevation),
            totalNetLots.Count > 0 ? totalNetLots.Sum(x => x.Lot.NetWeight!.Value) : null,
            totalGrossLots.Count > 0 ? totalGrossLots.Sum(x => x.Lot.GrossWeight!.Value) : null,
            totalNetLots.Count > 0 ? totalNetLots.Average(x => x.Lot.NetWeight!.Value) : null,
            totalGrossLots.Count > 0 ? totalGrossLots.Average(x => x.Lot.GrossWeight!.Value) : null
        ));
    }
}
