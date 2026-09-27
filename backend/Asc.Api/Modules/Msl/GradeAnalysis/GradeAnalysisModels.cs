using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Msl.GradeAnalysis;

public static class GradeAnalysisRowType
{
    public const string Grade = "GRADE";
    public const string MainTotal = "MAIN_TOTAL";
    public const string OffTotal = "OFF_TOTAL";
    public const string ElevationTotal = "ELEVATION_TOTAL";
    /// <summary>One elevation's line in the all-elevations summary file.</summary>
    public const string ElevationSummary = "ELEVATION_SUMMARY";
    public const string GrandTotal = "GRAND_TOTAL";
}

/// <summary>
/// One line of the monthly "All Brokers' Monthly Elevation Wise Grade Analysis &amp; Averages" report:
/// for one elevation and month, each grade's quantity (kg), average price (Rs/kg) and share of the
/// elevation's volume (percent), for the month and year to date. Grades are split into main and off
/// grades, each with a total line. Blank figures (a grade not sold that month) are null.
/// </summary>
public class GradeAnalysisRow
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int Month { get; set; }

    /// <summary>See <see cref="GradeAnalysisRowType"/>.</summary>
    public string RowType { get; set; } = GradeAnalysisRowType.Grade;

    /// <summary>LOW / UVA HIGH / WESTERN HIGH / UVA MEDIUM / WESTERN MEDIUM (null on the grand total).</summary>
    public string? Elevation { get; set; }

    /// <summary>MAIN or OFF for grade rows and the two group totals; null otherwise.</summary>
    public string? GradeGroup { get; set; }

    /// <summary>Grade code as printed (older reports truncate long names to 12 characters); null on totals.</summary>
    public string? Grade { get; set; }

    public decimal? MonthQtyKg { get; set; }
    public decimal? MonthAvgRs { get; set; }
    public decimal? MonthPct { get; set; }
    public decimal? TodateQtyKg { get; set; }
    public decimal? TodateAvgRs { get; set; }
    public decimal? TodatePct { get; set; }

    public string SourceFile { get; set; } = string.Empty;
}
