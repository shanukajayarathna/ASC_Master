using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Msl.FactoryAverages;

/// <summary>What a <see cref="FactoryAverage"/> row represents.</summary>
public static class FactoryAverageRowType
{
    public const string Factory = "FACTORY";
    public const string ElevationTotal = "ELEVATION_TOTAL";
    public const string GrandTotal = "GRAND_TOTAL";
}

/// <summary>
/// One line of a monthly "Factory Wise Averages" report (Asia Siyaka's FAC03 print-out of all
/// brokers' Colombo sales): for one factory (MF code) in one elevation and month, the quantity and
/// average price (Rs/kg) of its main-grade and off-grade teas, monthly and year-to-date, plus the
/// factory's rank within the elevation. The same table also carries one ELEVATION_TOTAL row per
/// elevation and a GRAND_TOTAL row, kept as rows so a month can be reconciled against its own totals.
/// "Cumulative" means year-to-date. Any figure the report leaves blank (no sales) is null.
/// </summary>
public class FactoryAverage
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int Month { get; set; }

    /// <summary>See <see cref="FactoryAverageRowType"/>.</summary>
    public string RowType { get; set; } = FactoryAverageRowType.Factory;

    /// <summary>UVA HIGH / WESTERN HIGH / UVA MEDIUM / WESTERN MEDIUM / LOW; null on the grand total.</summary>
    public string? Elevation { get; set; }

    /// <summary>Estate / factory name as printed (upper case); null on total rows.</summary>
    public string? FactoryName { get; set; }

    /// <summary>The factory's MF code, e.g. "MF0581" — the stable key (names vary between reports); null on total rows.</summary>
    public string? MfCode { get; set; }

    public decimal? MainMonthlyQtyKg { get; set; }
    public decimal? MainCumulativeQtyKg { get; set; }
    public decimal? OffMonthlyQtyKg { get; set; }
    public decimal? OffCumulativeQtyKg { get; set; }
    public decimal? TotalMonthlyQtyKg { get; set; }
    public decimal? TotalCumulativeQtyKg { get; set; }

    public decimal? MainMonthlyAvgRs { get; set; }
    public decimal? MainCumulativeAvgRs { get; set; }
    public decimal? OffMonthlyAvgRs { get; set; }
    public decimal? OffCumulativeAvgRs { get; set; }
    public decimal? TotalMonthlyAvgRs { get; set; }
    public decimal? TotalCumulativeAvgRs { get; set; }

    /// <summary>Rank within the elevation by total monthly quantity (factory rows only).</summary>
    public int? MonthlyRank { get; set; }

    /// <summary>Rank within the elevation by year-to-date quantity (factory rows only).</summary>
    public int? CumulativeRank { get; set; }

    /// <summary>Archive-relative path of the file this row came from, e.g. "factory-averages/2026/factory-averages-2026-08.txt".</summary>
    public string SourceFile { get; set; } = string.Empty;
}
