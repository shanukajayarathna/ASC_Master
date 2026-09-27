using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl.CombinedAverages;

public record CombinedAverageMonthDto(int Year, int Month, int Brokers, int Factories, decimal? TotalQtyKg, decimal? AvgPriceRs);

public record CombinedAverageRowDto(
    int Year, int Month, string? Broker, string RowType, string? Elevation, string? Factory, string? MfCode, string? SellingMark,
    decimal? QuantityKg, decimal? GrossProceedsRs, decimal? AvgRs);

/// <summary>
/// Read access to the Colombo Brokers' Association monthly "gross averages": every factory / selling mark each
/// broker sold — quantity (kg), gross proceeds (Rs) and combined average (Rs/kg) — with broker and grand totals,
/// for whatever months are dropped into data/msl/combined-averages (the 2018–2020 reports are archived as files in data/_archive-pre2023, so this is empty until newer ones arrive).
/// </summary>
[ApiController]
[Route("api/v1/msl/combined-averages")]
[Authorize]
public class CombinedAveragesController(MongoContext db) : ControllerBase
{
    private const int DefaultLimit = 2000;
    private const int MaxLimit = 5000;

    /// <summary>The months available, newest first, each with its grand total and how many brokers/factories it covers.</summary>
    [HttpGet("months")]
    public async Task<List<CombinedAverageMonthDto>> Months(CancellationToken ct)
    {
        var grand = await db.CombinedAverages.Find(r => r.RowType == CombinedAverageRowType.GrandTotal)
            .SortByDescending(r => r.Year).ThenByDescending(r => r.Month).ToListAsync(ct);
        var counts = (await db.CombinedAverages.Aggregate()
                .Match(r => r.RowType == CombinedAverageRowType.Factory)
                .Group(r => new { r.Year, r.Month }, g => new { g.Key.Year, g.Key.Month, Factories = g.Count(), Brokers = g.Select(x => x.Broker).Distinct().Count() })
                .ToListAsync(ct))
            .ToDictionary(x => (x.Year, x.Month));
        return grand.Select(g =>
        {
            counts.TryGetValue((g.Year, g.Month), out var c);
            return new CombinedAverageMonthDto(g.Year, g.Month, c?.Brokers ?? 0, c?.Factories ?? 0, g.QuantityKg, g.AvgRs);
        }).ToList();
    }

    /// <summary>
    /// Rows for one month (defaults to the latest), narrowed by broker name (contains), MF code, or a
    /// factory / selling-mark search. <c>rowType</c> is FACTORY (default), BROKER_TOTAL, BROKER_ELEVATION,
    /// GRAND_TOTAL, GRAND_ELEVATION or ALL.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<CombinedAverageRowDto>>> Rows(
        [FromQuery] int? year, [FromQuery] int? month, [FromQuery] string? broker, [FromQuery] string? code, [FromQuery] string? q,
        [FromQuery] string? rowType, [FromQuery] int? limit, CancellationToken ct)
    {
        if ((year is null) != (month is null)) return BadRequest("Give both year and month, or neither for the latest month.");
        if (year is null)
        {
            var latest = await db.CombinedAverages.Find(r => r.RowType == CombinedAverageRowType.GrandTotal)
                .SortByDescending(r => r.Year).ThenByDescending(r => r.Month).Limit(1).FirstOrDefaultAsync(ct);
            if (latest is null) return new List<CombinedAverageRowDto>();
            (year, month) = (latest.Year, latest.Month);
        }

        var fb = Builders<CombinedAverageRow>.Filter;
        var filter = fb.Eq(r => r.Year, year.Value) & fb.Eq(r => r.Month, month!.Value);
        var type = string.IsNullOrWhiteSpace(rowType) ? CombinedAverageRowType.Factory : rowType.ToUpperInvariant();
        if (type != "ALL") filter &= fb.Eq(r => r.RowType, type);
        if (!string.IsNullOrWhiteSpace(broker))
            filter &= fb.Regex(r => r.Broker, new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(broker.Trim()), "i"));
        if (!string.IsNullOrWhiteSpace(code)) filter &= fb.Eq(r => r.MfCode, code.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(q))
        {
            var rx = new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(q.Trim()), "i");
            filter &= fb.Regex(r => r.Factory, rx) | fb.Regex(r => r.SellingMark, rx);
        }

        var rows = await db.CombinedAverages.Find(filter)
            .SortBy(r => r.Broker).ThenByDescending(r => r.QuantityKg)
            .Limit(Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit)).ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    /// <summary>One factory's history by MF code (oldest first): every broker/mark line it appears on, by month.</summary>
    [HttpGet("factory/{mfCode}")]
    public async Task<ActionResult<List<CombinedAverageRowDto>>> History(string mfCode, CancellationToken ct)
    {
        var rows = await db.CombinedAverages
            .Find(r => r.RowType == CombinedAverageRowType.Factory && r.MfCode == mfCode.Trim().ToUpperInvariant())
            .SortBy(r => r.Year).ThenBy(r => r.Month).ThenBy(r => r.Broker).ToListAsync(ct);
        return rows.Count == 0 ? NotFound($"No combined averages for MF code '{mfCode}'.") : rows.Select(ToDto).ToList();
    }

    private static CombinedAverageRowDto ToDto(CombinedAverageRow r) => new(
        r.Year, r.Month, r.Broker, r.RowType, r.Elevation, r.Factory, r.MfCode, r.SellingMark, r.QuantityKg, r.GrossProceedsRs, r.AvgRs);
}
