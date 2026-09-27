using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Msl.CombinedAverages;

public static class CombinedAverageRowType
{
    /// <summary>One factory / selling mark sold through one broker.</summary>
    public const string Factory = "FACTORY";
    /// <summary>A broker's total for the month.</summary>
    public const string BrokerTotal = "BROKER_TOTAL";
    /// <summary>A broker's total for one elevation group (HIGH-UVA, HIGH-WESTERN, ..., LOW).</summary>
    public const string BrokerElevation = "BROKER_ELEVATION";
    /// <summary>All brokers together for the month.</summary>
    public const string GrandTotal = "GRAND_TOTAL";
    /// <summary>All brokers together for one elevation group.</summary>
    public const string GrandElevation = "GRAND_ELEVATION";
}

/// <summary>
/// One line of the Colombo Brokers' Association monthly "Gross Averages" report: for each broker, every
/// factory / selling mark it sold that month — quantity (kg), gross proceeds (Rs) and the combined average
/// (Rs/kg) — followed by the broker's totals, split by elevation group, and finally the totals of all
/// brokers. "Gross" proceeds are the sold value before broker charges.
/// </summary>
public class CombinedAverageRow
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int Month { get; set; }

    /// <summary>The broker as printed in the page header (e.g. "LANKA COMMODITY BROKERS LTD"); null on grand totals.</summary>
    public string? Broker { get; set; }

    /// <summary>See <see cref="CombinedAverageRowType"/>.</summary>
    public string RowType { get; set; } = CombinedAverageRowType.Factory;

    /// <summary>Elevation group on the elevation rows: "HIGH - UVA", "HIGH - WESTERN", "HIGH - OTHERS", "MEDIUM - UVA", "MEDIUM - WESTERN", "MEDIUM - OTHERS", "LOW".</summary>
    public string? Elevation { get; set; }

    public string? Factory { get; set; }

    /// <summary>The factory's MF code (or the older BF/HT/RT-style code) — the stable key.</summary>
    public string? MfCode { get; set; }

    public string? SellingMark { get; set; }

    public decimal? QuantityKg { get; set; }
    public decimal? GrossProceedsRs { get; set; }
    public decimal? AvgRs { get; set; }

    /// <summary>The "UNIT RATE" printed under the factory (15.000 in every report seen).</summary>
    public decimal? UnitRate { get; set; }

    public string SourceFile { get; set; } = string.Empty;
}
