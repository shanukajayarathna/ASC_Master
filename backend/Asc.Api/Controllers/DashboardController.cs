using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

[ApiController]
[Route("api/catalogues/{catalogueId:guid}/dashboard")]
public class DashboardController(MongoContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<DashboardStatsDto>> Get(Guid catalogueId)
    {
        var lots = await db.Lots.Find(l => l.CatalogueId == catalogueId).ToListAsync();

        var total = lots.Count;
        if (total == 0)
            return Ok(new DashboardStatsDto(0, 0, 0, 0, null, null, null, null, null, null, null, null, null, null, null, null));

        bool IsComplete(Lot l) => l.Valuation is not null &&
            (l.Valuation.ValuationSingle != null || l.Valuation.ValuationFrom != null) &&
            !string.IsNullOrEmpty(l.Valuation.StandardData) && !string.IsNullOrEmpty(l.Valuation.LiquorRemarks);

        var completed = lots.Count(IsComplete);
        var pending = total - completed;

        var today = DateTime.UtcNow.Date;
        var todayCount = lots.Count(l => l.Valuation != null && l.Valuation.UpdatedAt.Date == today);

        var values = lots.Where(l => l.Valuation?.EffectiveValue != null).Select(l => l.Valuation!.EffectiveValue!.Value).ToList();

        var rangeWidths = lots
            .Where(l => l.Valuation is { ValuationFrom: not null, ValuationTo: not null })
            .Select(l => l.Valuation!.ValuationTo!.Value - l.Valuation.ValuationFrom!.Value)
            .ToList();

        string? MostCommon(Func<Lot, string?> selector) =>
            lots.Select(selector).Where(v => !string.IsNullOrEmpty(v))
                .GroupBy(v => v).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();

        var totalNetLots = lots.Where(l => l.NetWeight != null).ToList();
        var totalGrossLots = lots.Where(l => l.GrossWeight != null).ToList();

        return Ok(new DashboardStatsDto(
            total, completed, pending, todayCount,
            values.Count > 0 ? values.Average() : null,
            values.Count > 0 ? values.Max() : null,
            values.Count > 0 ? values.Min() : null,
            rangeWidths.Count > 0 ? rangeWidths.Average() : null,
            MostCommon(l => l.Broker), MostCommon(l => l.Grade), MostCommon(l => l.Category), MostCommon(l => l.Elevation),
            totalNetLots.Count > 0 ? totalNetLots.Sum(l => l.NetWeight!.Value) : null,
            totalGrossLots.Count > 0 ? totalGrossLots.Sum(l => l.GrossWeight!.Value) : null,
            totalNetLots.Count > 0 ? totalNetLots.Average(l => l.NetWeight!.Value) : null,
            totalGrossLots.Count > 0 ? totalGrossLots.Average(l => l.GrossWeight!.Value) : null
        ));
    }
}
