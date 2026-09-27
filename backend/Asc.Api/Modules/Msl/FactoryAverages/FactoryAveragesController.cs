using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl.FactoryAverages;

public record FactoryAverageMonthDto(int Year, int Month, int Factories, decimal? TotalQtyKg, decimal? AvgPriceRs);

public record FactoryAverageRowDto(
    int Year, int Month, string RowType, string? Elevation, string? FactoryName, string? MfCode,
    decimal? MainMonthlyQtyKg, decimal? MainMonthlyAvgRs, decimal? MainCumulativeQtyKg, decimal? MainCumulativeAvgRs,
    decimal? OffMonthlyQtyKg, decimal? OffMonthlyAvgRs, decimal? OffCumulativeQtyKg, decimal? OffCumulativeAvgRs,
    decimal? TotalMonthlyQtyKg, decimal? TotalMonthlyAvgRs, decimal? TotalCumulativeQtyKg, decimal? TotalCumulativeAvgRs,
    int? MonthlyRank, int? CumulativeRank);

/// <summary>
/// Read access to the monthly Factory Wise Averages reports (every factory's quantity and average
/// price by elevation, main vs off grade, monthly and year-to-date, with rank) — the archive's
/// factory-level price history from Jan 2023 (earlier months are kept as files in data/_archive-pre2023, not loaded). Quantities are kg, prices Rs/kg.
/// </summary>
[ApiController]
[Route("api/v1/msl/factory-averages")]
[Authorize]
public class FactoryAveragesController(MongoContext db) : ControllerBase
{
    private const int DefaultLimit = 2000;
    private const int MaxLimit = 5000;

    /// <summary>The months available, newest first, each with its factory count and grand total.</summary>
    [HttpGet("months")]
    public async Task<List<FactoryAverageMonthDto>> Months(CancellationToken ct)
    {
        var grand = await db.FactoryAverages.Find(f => f.RowType == FactoryAverageRowType.GrandTotal)
            .SortByDescending(f => f.Year).ThenByDescending(f => f.Month).ToListAsync(ct);
        var counts = (await db.FactoryAverages.Aggregate()
                .Match(f => f.RowType == FactoryAverageRowType.Factory)
                .Group(f => new { f.Year, f.Month }, g => new { g.Key.Year, g.Key.Month, N = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => (x.Year, x.Month), x => x.N);
        return grand.Select(g => new FactoryAverageMonthDto(
            g.Year, g.Month, counts.GetValueOrDefault((g.Year, g.Month)), g.TotalMonthlyQtyKg, g.TotalMonthlyAvgRs)).ToList();
    }

    /// <summary>
    /// Rows for one month (defaults to the latest), optionally narrowed to an elevation, an MF code, or
    /// a name search. <c>rowType</c> is FACTORY (default), ELEVATION_TOTAL, GRAND_TOTAL, or ALL.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<FactoryAverageRowDto>>> Rows(
        [FromQuery] int? year, [FromQuery] int? month, [FromQuery] string? elevation, [FromQuery] string? code,
        [FromQuery] string? q, [FromQuery] string? rowType, [FromQuery] int? limit, CancellationToken ct)
    {
        if ((year is null) != (month is null)) return BadRequest("Give both year and month, or neither for the latest month.");
        if (year is null)
        {
            var latest = await db.FactoryAverages.Find(f => f.RowType == FactoryAverageRowType.GrandTotal)
                .SortByDescending(f => f.Year).ThenByDescending(f => f.Month).Limit(1).FirstOrDefaultAsync(ct);
            if (latest is null) return new List<FactoryAverageRowDto>();
            (year, month) = (latest.Year, latest.Month);
        }

        var fb = Builders<FactoryAverage>.Filter;
        var filter = fb.Eq(f => f.Year, year.Value) & fb.Eq(f => f.Month, month!.Value);
        var type = string.IsNullOrWhiteSpace(rowType) ? FactoryAverageRowType.Factory : rowType.ToUpperInvariant();
        if (type != "ALL") filter &= fb.Eq(f => f.RowType, type);
        if (!string.IsNullOrWhiteSpace(elevation)) filter &= fb.Eq(f => f.Elevation, elevation.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(code)) filter &= fb.Eq(f => f.MfCode, code.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(q))
            filter &= fb.Regex(f => f.FactoryName, new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(q.Trim()), "i"));

        var rows = await db.FactoryAverages.Find(filter)
            .SortBy(f => f.Elevation).ThenBy(f => f.MonthlyRank).ThenBy(f => f.FactoryName)
            .Limit(Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit))
            .ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    /// <summary>One factory's monthly history (oldest first) by MF code, optionally from a given year.</summary>
    [HttpGet("factory/{code}")]
    public async Task<ActionResult<List<FactoryAverageRowDto>>> History(string code, [FromQuery] int? fromYear, CancellationToken ct)
    {
        var fb = Builders<FactoryAverage>.Filter;
        var filter = fb.Eq(f => f.MfCode, code.Trim().ToUpperInvariant()) & fb.Eq(f => f.RowType, FactoryAverageRowType.Factory);
        if (fromYear is not null) filter &= fb.Gte(f => f.Year, fromYear.Value);
        var rows = await db.FactoryAverages.Find(filter).SortBy(f => f.Year).ThenBy(f => f.Month).ToListAsync(ct);
        return rows.Count == 0 ? NotFound($"No factory averages for MF code '{code}'.") : rows.Select(ToDto).ToList();
    }

    private static FactoryAverageRowDto ToDto(FactoryAverage f) => new(
        f.Year, f.Month, f.RowType, f.Elevation, f.FactoryName, f.MfCode,
        f.MainMonthlyQtyKg, f.MainMonthlyAvgRs, f.MainCumulativeQtyKg, f.MainCumulativeAvgRs,
        f.OffMonthlyQtyKg, f.OffMonthlyAvgRs, f.OffCumulativeQtyKg, f.OffCumulativeAvgRs,
        f.TotalMonthlyQtyKg, f.TotalMonthlyAvgRs, f.TotalCumulativeQtyKg, f.TotalCumulativeAvgRs,
        f.MonthlyRank, f.CumulativeRank);
}
