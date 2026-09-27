using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl.PlantationRanking;

public record PlantationRankingMonthDto(int Year, int Month, string[] Elevations, int Companies);

public record PlantationRankingRowDto(
    int Year, int Month, string Elevation, string RowType, string? Company, string? Broker,
    decimal? MonthQtyKg, int? MonthQtyRank, decimal? MonthAvgRs, int? MonthAvgRank,
    decimal? TodateQtyKg, int? TodateQtyRank, decimal? TodateAvgRs, int? TodateAvgRank);

/// <summary>
/// Read access to the monthly plantation-company ranking reports ("Performance of Companies"): for
/// each elevation, every plantation company's quantity and average price with its rank, and the
/// brokers behind each — for whatever months are dropped into data/msl/plantation-ranking (the 2018 to 2020 reports are archived as files in data/_archive-pre2023). Quantities are kg, prices Rs/kg.
/// </summary>
[ApiController]
[Route("api/v1/msl/plantation-ranking")]
[Authorize]
public class PlantationRankingController(MongoContext db) : ControllerBase
{
    private const int DefaultLimit = 2000;
    private const int MaxLimit = 5000;

    /// <summary>The months available, newest first, with the elevations each covers and its company count.</summary>
    [HttpGet("months")]
    public async Task<List<PlantationRankingMonthDto>> Months(CancellationToken ct)
    {
        var companies = await db.PlantationRankings.Find(r => r.RowType == PlantationRowType.Company)
            .Project(r => new { r.Year, r.Month, r.Elevation }).ToListAsync(ct);
        return companies.GroupBy(c => (c.Year, c.Month))
            .OrderByDescending(g => g.Key.Year).ThenByDescending(g => g.Key.Month)
            .Select(g => new PlantationRankingMonthDto(g.Key.Year, g.Key.Month, [.. g.Select(x => x.Elevation).Distinct().Order()], g.Count()))
            .ToList();
    }

    /// <summary>
    /// Rows for one month (defaults to the latest), narrowed by elevation (HIGH / MEDIUM / LOW / OVERALL) and/or
    /// a company-name search. <c>rowType</c> is COMPANY (default), BROKER, TOTAL or ALL.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<PlantationRankingRowDto>>> Rows(
        [FromQuery] int? year, [FromQuery] int? month, [FromQuery] string? elevation, [FromQuery] string? company,
        [FromQuery] string? rowType, [FromQuery] int? limit, CancellationToken ct)
    {
        if ((year is null) != (month is null)) return BadRequest("Give both year and month, or neither for the latest month.");
        if (year is null)
        {
            var latest = await db.PlantationRankings.Find(r => r.RowType == PlantationRowType.Company)
                .SortByDescending(r => r.Year).ThenByDescending(r => r.Month).Limit(1).FirstOrDefaultAsync(ct);
            if (latest is null) return new List<PlantationRankingRowDto>();
            (year, month) = (latest.Year, latest.Month);
        }

        var fb = Builders<PlantationRankingRow>.Filter;
        var filter = fb.Eq(r => r.Year, year.Value) & fb.Eq(r => r.Month, month!.Value);
        var type = string.IsNullOrWhiteSpace(rowType) ? PlantationRowType.Company : rowType.ToUpperInvariant();
        if (type != "ALL") filter &= fb.Eq(r => r.RowType, type);
        if (!string.IsNullOrWhiteSpace(elevation)) filter &= fb.Eq(r => r.Elevation, elevation.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(company))
            filter &= fb.Regex(r => r.Company, new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(company.Trim()), "i"));

        var rows = await db.PlantationRankings.Find(filter)
            .SortBy(r => r.Elevation).ThenBy(r => r.MonthAvgRank).ThenBy(r => r.Company)
            .Limit(Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit)).ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    /// <summary>One plantation company's monthly history (oldest first) by name search, optionally within one elevation.</summary>
    [HttpGet("company/{name}")]
    public async Task<ActionResult<List<PlantationRankingRowDto>>> History(string name, [FromQuery] string? elevation, CancellationToken ct)
    {
        var fb = Builders<PlantationRankingRow>.Filter;
        var filter = fb.Eq(r => r.RowType, PlantationRowType.Company) &
                     fb.Regex(r => r.Company, new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(name.Trim()), "i"));
        if (!string.IsNullOrWhiteSpace(elevation)) filter &= fb.Eq(r => r.Elevation, elevation.Trim().ToUpperInvariant());
        var rows = await db.PlantationRankings.Find(filter).SortBy(r => r.Year).ThenBy(r => r.Month).ThenBy(r => r.Elevation).ToListAsync(ct);
        return rows.Count == 0 ? NotFound($"No plantation ranking rows for company '{name}'.") : rows.Select(ToDto).ToList();
    }

    private static PlantationRankingRowDto ToDto(PlantationRankingRow r) => new(
        r.Year, r.Month, r.Elevation, r.RowType, r.Company, r.Broker,
        r.MonthQtyKg, r.MonthQtyRank, r.MonthAvgRs, r.MonthAvgRank,
        r.TodateQtyKg, r.TodateQtyRank, r.TodateAvgRs, r.TodateAvgRank);
}
