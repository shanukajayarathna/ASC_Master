using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// One lot row parsed from a broker MSL TXT file (the fixed-width weekly auction files,
/// 2013–present) or a PVT private-sales file. Field names are shortened at the BSON level
/// because this collection holds millions of rows — with ~20 fields per document the field
/// names themselves would otherwise cost more disk than the values.
/// </summary>
public class AuctionLot
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonElement("y")] public int SaleYear { get; set; }

    /// <summary>The auction sale the lot belongs to — private-sale rows carry their real
    /// sale number too (the PVT files tag every transaction with the week's sale).</summary>
    [BsonElement("s")] public int SaleNo { get; set; }

    [BsonElement("d")] public DateTime SaleDate { get; set; }

    /// <summary>File code: AS, BTL, DES, EB, FBS, JK, LCB, MB — present on auction AND
    /// private rows (both carry the broker digit in the row header).</summary>
    [BsonElement("b")] public string? Broker { get; set; }

    [BsonElement("pv")] public bool IsPrivate { get; set; }

    [BsonElement("l")] public string LotNo { get; set; } = string.Empty;

    [BsonElement("i")] public string? Invoice { get; set; }

    /// <summary>Space-stripped factory registration code, e.g. "MF0351", "MFA0890", "RT0271"
    /// (RT = refuse-tea processing centre). Matches the sale Excel's "Trade Mark" column
    /// after the same normalization.</summary>
    [BsonElement("f")] public string FactoryCode { get; set; } = string.Empty;

    [BsonElement("m")] public string SellingMark { get; set; } = string.Empty;

    [BsonElement("g")] public string Grade { get; set; } = string.Empty;

    [BsonElement("q")] public decimal QuantityKg { get; set; }

    /// <summary>Sold price in Rs/kg; 0 means unsold.</summary>
    [BsonElement("p")] public decimal PriceRs { get; set; }

    [BsonElement("so")] public bool Sold { get; set; }

    [BsonElement("bc")] public string? BuyerCode { get; set; }
    [BsonElement("bn")] public string? BuyerName { get; set; }

    [BsonElement("e")] public string EstateName { get; set; } = string.Empty;

    [BsonElement("dc")] public string? DistrictCode { get; set; }

    /// <summary>The MSL code: factory code + 2-digit region suffix, space-stripped
    /// (e.g. "MF035111"). Stable across brokers for the same estate.</summary>
    [BsonElement("mc")] public string? MslCode { get; set; }

    /// <summary>Elevation category code: 11 UVA HIGH, 12 WESTERN HIGH, 21 UVA MEDIUM,
    /// 22 WESTERN MEDIUM, 31 LOW.</summary>
    [BsonElement("el")] public string? ElevationCode { get; set; }

    /// <summary>Raw trailing class code (elevation + manufacture/subtype digits).</summary>
    [BsonElement("cl")] public string? ClassCode { get; set; }

    [BsonElement("rf")] public bool RefuseTea { get; set; }

    /// <summary>Path relative to the MSL data root — the idempotent-import key: re-importing
    /// a file first deletes everything with the same SourceFile.</summary>
    [BsonElement("sf")] public string SourceFile { get; set; } = string.Empty;

    /// <summary>Bags and per-bag packing (kg) — not in the MSL files; enriched from the
    /// weekly sale Excel catalogues where one exists (2026+), null otherwise.</summary>
    [BsonElement("bg")] public int? Bags { get; set; }
    [BsonElement("pk")] public decimal? PackingKg { get; set; }

    /// <summary>The catalogue section the lot was offered under ("Ex-estate",
    /// "High and Medium", …) — Excel-enriched like bags/packing; not present in MSL files
    /// (verified: the class-code digits do not encode it). Null for private rows and
    /// pre-Excel years.</summary>
    [BsonElement("ct")] public string? SaleCategory { get; set; }

    /// <summary>The OKLO auction system's outcome ("Sold", "Outsold", "Unsold", "Pending")
    /// from the sale Excel's Status column — distinguishes outsold lots, which the MSL
    /// settlement records as plain sold. Excel-enriched, 2026+ only.</summary>
    [BsonElement("st")] public string? OkloStatus { get; set; }

    /// <summary>The broker's asking price (Rs/kg) from the sale Excel — Excel-enriched.</summary>
    [BsonElement("ak")] public decimal? AskingRs { get; set; }
}

/// <summary>One elevation row of a monthly Sri Lanka Tea Board national averages report.</summary>
public class TeaBoardAverage
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int Month { get; set; }

    /// <summary>ORTHODOX, CTC, COMBINED, GREEN, ORGANIC, SPECIAL, REFUSE or COMPOSITE.</summary>
    public string Section { get; set; } = string.Empty;

    /// <summary>UVA HIGH / WESTERN HIGH / UVA MEDIUM / WESTERN MEDIUM / LOW — plus the
    /// composite section's HIGH GROWN / MEDIUM GROWN / LOW GROWN / ALL TEA / OTHER rows,
    /// and TOTAL rows per section.</summary>
    public string Elevation { get; set; } = string.Empty;

    public decimal? MonthQtyKg { get; set; }
    public decimal? MonthAvgRs { get; set; }
    public decimal? TodateQtyKg { get; set; }
    public decimal? TodateAvgRs { get; set; }

    public string SourceFile { get; set; } = string.Empty;
}

/// <summary>
/// Materialized analytics rollup: one row per (sale, dimension, key) with every measure the
/// Analysis screens need. Rebuilt per-sale after each import (one in-memory pass over that
/// sale's lots), so the pre/post-auction dashboards read a few hundred tiny rows instead of
/// aggregating millions — this is what makes the analytics render instantly.
/// SaleNo 0 holds a year's private-sale rows.
/// </summary>
public class MslSaleStat
{
    [BsonId]
    public ObjectId Id { get; set; }

    public int Year { get; set; }
    public int SaleNo { get; set; }
    public DateTime SaleDate { get; set; }

    /// <summary>total | broker | grade | elevation | buyer | mark | factory | priceRange.</summary>
    public string Dimension { get; set; } = string.Empty;

    /// <summary>The dimension member ("AS", "BOPF", "12", buyer code, mark, bucket label);
    /// "all" for the total row.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Display label where Key is a code (buyer name for buyer codes, elevation
    /// name for elevation codes); null when Key is already presentable.</summary>
    public string? Label { get; set; }

    public long Lots { get; set; }
    public long SoldLots { get; set; }
    public decimal TotalQtyKg { get; set; }
    public decimal SoldQtyKg { get; set; }

    /// <summary>Sum of price × quantity over sold lots (Rs) — the portal's "proceeds".</summary>
    public decimal ProceedsRs { get; set; }

    public decimal? MinPriceRs { get; set; }
    public decimal? MaxPriceRs { get; set; }
}

/// <summary>Import bookkeeping — one row per data file, so the folder watcher and rescans
/// only re-import files whose size or timestamp changed.</summary>
public class MslFileState
{
    [BsonId]
    public string RelativePath { get; set; } = string.Empty;

    public long Length { get; set; }
    public DateTime LastWriteUtc { get; set; }
    public DateTime ImportedAt { get; set; }
    public int RowCount { get; set; }
    public string? Error { get; set; }
}

public static class MslBrokers
{
    /// <summary>Broker digit (column 2 of every auction row) → file/broker code.</summary>
    public static readonly IReadOnlyDictionary<char, string> DigitToCode = new Dictionary<char, string>
    {
        ['1'] = "BTL", ['2'] = "DES", ['3'] = "FBS", ['4'] = "JK",
        ['6'] = "EB", ['7'] = "MB", ['8'] = "AS", ['9'] = "LCB",
    };

    public static readonly IReadOnlyDictionary<string, string> CodeToName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["BTL"] = "Bartleet & Co",
        ["DES"] = "Ceylon Tea Brokers",
        ["FBS"] = "Forbes & Walker",
        ["JK"] = "John Keells",
        ["EB"] = "Eastern Brokers",
        ["MB"] = "Mercantile Produce Brokers",
        ["AS"] = "Asia Siyaka",
        ["LCB"] = "Lanka Commodity Brokers",
    };

    /// <summary>Broker codes used by the weekly sale Excel files (data/sales/NN.xlsx) →
    /// MSL file code. Verified row-level against real files: joining on (broker, lot no)
    /// matches 99.7% of Excel rows to their MSL rows.</summary>
    public static readonly IReadOnlyDictionary<string, string> ExcelCodeToMslCode = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["ASC"] = "AS", ["BC"] = "BTL", ["CT"] = "DES", ["FW"] = "FBS",
        ["JK"] = "JK", ["EB"] = "EB", ["MPB"] = "MB", ["LC"] = "LCB",
    };

    public static readonly IReadOnlyDictionary<string, string> ElevationNames = new Dictionary<string, string>
    {
        ["11"] = "UVA HIGH",
        ["12"] = "WESTERN HIGH",
        ["21"] = "UVA MEDIUM",
        ["22"] = "WESTERN MEDIUM",
        ["31"] = "LOW",
    };
}
