using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Msl.PlantationRanking;

public static class PlantationRowType
{
    /// <summary>A plantation company's line: its total quantity and average price, and its ranks.</summary>
    public const string Company = "COMPANY";
    /// <summary>One broker's share of the company line above it (quantity and average only).</summary>
    public const string Broker = "BROKER";
    /// <summary>The elevation's total line (quantity and average only).</summary>
    public const string Total = "TOTAL";
}

/// <summary>
/// One line of the monthly "Performance of Companies" (plantation ranking) report: how a plantation
/// company's teas sold in one elevation (HIGH / MEDIUM / LOW, or OVERALL) — quantity (kg) and average
/// price (Rs/kg) for the month and year to date, each with the company's rank among the companies —
/// followed by the same figures split by the brokers that sold them. Blank figures are null.
/// </summary>
public class PlantationRankingRow
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int Month { get; set; }

    /// <summary>HIGH, MEDIUM, LOW or OVERALL.</summary>
    public string Elevation { get; set; } = string.Empty;

    /// <summary>See <see cref="PlantationRowType"/>.</summary>
    public string RowType { get; set; } = PlantationRowType.Company;

    /// <summary>Plantation company as printed (older reports truncate it to about 19 characters); null on the total line.</summary>
    public string? Company { get; set; }

    /// <summary>Broker as printed (truncated to about 16 characters) — broker rows only.</summary>
    public string? Broker { get; set; }

    public decimal? MonthQtyKg { get; set; }
    public int? MonthQtyRank { get; set; }
    public decimal? MonthAvgRs { get; set; }
    public int? MonthAvgRank { get; set; }
    public decimal? TodateQtyKg { get; set; }
    public int? TodateQtyRank { get; set; }
    public decimal? TodateAvgRs { get; set; }
    public int? TodateAvgRank { get; set; }

    public string SourceFile { get; set; } = string.Empty;
}
