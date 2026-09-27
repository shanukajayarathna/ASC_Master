using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl.GradeAnalysis;

public record GradeAnalysisMonthDto(int Year, int Month, decimal? TotalQtyKg, decimal? AvgPriceRs);

public record GradeAnalysisRowDto(
    int Year, int Month, string RowType, string? Elevation, string? GradeGroup, string? Grade,
    decimal? MonthQtyKg, decimal? MonthAvgRs, decimal? MonthPct, decimal? TodateQtyKg, decimal? TodateAvgRs, decimal? TodatePct);

/// <summary>
/// Read access to the monthly grade-analysis reports (all brokers' quantity, average price and share
/// by elevation and grade, main vs off grade, monthly and year to date) — for whatever months are dropped
/// into data/msl/grade-analysis (the 2018 to early 2020 reports are archived as files in data/_archive-pre2023). Quantities are kg, prices Rs/kg.
/// </summary>
[ApiController]
[Route("api/v1/msl/grade-analysis")]
[Authorize]
public class GradeAnalysisController(MongoContext db) : ControllerBase
{
    private const int DefaultLimit = 2000;
    private const int MaxLimit = 5000;

    /// <summary>The months available, newest first, each with its all-elevations grand total.</summary>
    [HttpGet("months")]
    public async Task<List<GradeAnalysisMonthDto>> Months(CancellationToken ct)
    {
        var grand = await db.GradeAnalysis.Find(r => r.RowType == GradeAnalysisRowType.GrandTotal)
            .SortByDescending(r => r.Year).ThenByDescending(r => r.Month).ToListAsync(ct);
        // A month can have a grand total from both its per-elevation file and its all-elevations summary.
        return grand.GroupBy(g => (g.Year, g.Month))
            .Select(g => g.First())
            .Select(g => new GradeAnalysisMonthDto(g.Year, g.Month, g.MonthQtyKg, g.MonthAvgRs))
            .ToList();
    }

    /// <summary>
    /// Rows for one month (defaults to the latest), narrowed by elevation and/or grade (prefix match).
    /// <c>rowType</c> is GRADE (default), MAIN_TOTAL, OFF_TOTAL, ELEVATION_TOTAL, ELEVATION_SUMMARY,
    /// GRAND_TOTAL or ALL.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<GradeAnalysisRowDto>>> Rows(
        [FromQuery] int? year, [FromQuery] int? month, [FromQuery] string? elevation, [FromQuery] string? grade,
        [FromQuery] string? rowType, [FromQuery] int? limit, CancellationToken ct)
    {
        if ((year is null) != (month is null)) return BadRequest("Give both year and month, or neither for the latest month.");
        if (year is null)
        {
            var latest = await db.GradeAnalysis.Find(r => r.RowType == GradeAnalysisRowType.Grade)
                .SortByDescending(r => r.Year).ThenByDescending(r => r.Month).Limit(1).FirstOrDefaultAsync(ct);
            if (latest is null) return new List<GradeAnalysisRowDto>();
            (year, month) = (latest.Year, latest.Month);
        }

        var fb = Builders<GradeAnalysisRow>.Filter;
        var filter = fb.Eq(r => r.Year, year.Value) & fb.Eq(r => r.Month, month!.Value);
        var type = string.IsNullOrWhiteSpace(rowType) ? GradeAnalysisRowType.Grade : rowType.ToUpperInvariant();
        if (type != "ALL") filter &= fb.Eq(r => r.RowType, type);
        if (!string.IsNullOrWhiteSpace(elevation)) filter &= fb.Eq(r => r.Elevation, elevation.Trim().ToUpperInvariant());
        if (!string.IsNullOrWhiteSpace(grade))
            filter &= fb.Regex(r => r.Grade, new MongoDB.Bson.BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(grade.Trim()), "i"));

        var rows = await db.GradeAnalysis.Find(filter)
            .SortBy(r => r.Elevation).ThenByDescending(r => r.MonthQtyKg)
            .Limit(Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit)).ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    /// <summary>One grade's history across the months held (oldest first), optionally within one elevation.</summary>
    [HttpGet("grade/{grade}")]
    public async Task<ActionResult<List<GradeAnalysisRowDto>>> History(string grade, [FromQuery] string? elevation, CancellationToken ct)
    {
        var fb = Builders<GradeAnalysisRow>.Filter;
        var filter = fb.Eq(r => r.RowType, GradeAnalysisRowType.Grade) &
                     fb.Regex(r => r.Grade, new MongoDB.Bson.BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(grade.Trim()) + "$", "i"));
        if (!string.IsNullOrWhiteSpace(elevation)) filter &= fb.Eq(r => r.Elevation, elevation.Trim().ToUpperInvariant());
        var rows = await db.GradeAnalysis.Find(filter).SortBy(r => r.Year).ThenBy(r => r.Month).ThenBy(r => r.Elevation).ToListAsync(ct);
        return rows.Count == 0 ? NotFound($"No grade analysis rows for grade '{grade}'.") : rows.Select(ToDto).ToList();
    }

    private static GradeAnalysisRowDto ToDto(GradeAnalysisRow r) => new(
        r.Year, r.Month, r.RowType, r.Elevation, r.GradeGroup, r.Grade,
        r.MonthQtyKg, r.MonthAvgRs, r.MonthPct, r.TodateQtyKg, r.TodateAvgRs, r.TodatePct);
}
