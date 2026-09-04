using System.Text.RegularExpressions;
using Asc.Api.Models;
using Asc.Api.Services;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Known Colombo brokers this report can ingest a raw pre-sale catalogue file from, plus
/// ASC's own file (already header-based, parsed via the generic CatalogueImportService
/// path instead of a bespoke positional parser below).
/// </summary>
public static class BrokerCode
{
    public const string Asc = "ASC";
    // "EB", not the "AEB" the filename suggests — the raw AEB file's own Broker column
    // (and Modules/Msl/MslModels.cs's ExcelCodeToMslCode) both say "EB".
    public const string Aeb = "EB";
    public const string Bc = "BC";
    public const string Jk = "JK";
    public const string Lcbl = "LC";
    // "MPB", not the "MB" the raw pre-sale file's own Broker column says — MslModels.cs's
    // ExcelCodeToMslCode uses "MPB" as this broker's app-wide code (matching /data/sales'
    // own General Report, which also spells it "MPB"), so upload- and /data/sales-sourced
    // reports display the same broker code for the same broker.
    public const string Mb = "MPB";
    public const string Fw = "FW";
    public const string Ctb = "CT";

    public static readonly IReadOnlyList<string> All = [Asc, Aeb, Bc, Jk, Lcbl, Mb, Fw, Ctb];
}

/// <summary>
/// Parses the raw per-broker pre-sale catalogue Excel files ("SALE NO;36 ALL BORKERS CAT
/// FILES") into the same Lot shape SharedMarkCatalogueService.BuildRows already consumes
/// from /data/sales — letting a user generate the "Sharing Mark Catalogued Summary" for an
/// upcoming sale before /data/sales has anything for it (see SharedMarkCatalogueService's
/// own doc comment for why /data/sales can't be relied on here).
///
/// Every broker's file is a genuinely different raw layout — none share a schema, most have
/// no header row, two (JK, LCBL) don't even carry their own Broker/Year/SaleNo columns — so
/// the caller's own target sale number is stamped onto every Lot here rather than trusted
/// from the file. None carry the "RP" reprint flag /data/sales' enriched General Report has,
/// so reprint status is inferred the same way it was validated against real RP=Yes rows
/// earlier: NettWeight not matching Chests x ChestWeight. Column positions below are keyed
/// to the real Sale 36/2026 sample files; a broker changing its export format silently
/// breaks its own parser — there is no schema to validate against up front, so a
/// wildly-wrong column count is the only signal (rows with too few columns are simply
/// skipped).
/// </summary>
public static class BrokerCatalogueUploadParser
{
    private const decimal ReprintToleranceKg = 0.5m;

    /// <summary>Strips the trailing letter suffix from an MF code (MF1465A -> MF1465) and
    /// leading zeros immediately after the "MF" prefix (MF01257 -> MF1257) — brokers pad
    /// differently for the exact same estate (confirmed: MB's MF01257 vs LCBL's MF1257 for
    /// UPLANDS), so without this normalization the same estate would be split into two
    /// unrelated "Factory" groups depending on which broker's file it came from.</summary>
    public static string NormalizeFactoryCode(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        var m = Regex.Match(trimmed, @"^([A-Z]+)0*(\d+)[A-Z]*$");
        return m.Success ? $"{m.Groups[1].Value}{m.Groups[2].Value}" : trimmed;
    }

    private static bool IsReprint(decimal nettWeight, decimal chests, decimal chestWeight) =>
        Math.Abs(nettWeight - chests * chestWeight) > ReprintToleranceKg;

    private static decimal ParseDecimal(string raw) =>
        decimal.TryParse(raw.Trim().Replace(",", ""), out var d) ? d : 0m;

    private static Lot? BuildLot(string broker, int saleNo, string mfCode, string sellingMark, string grade,
        string chestsRaw, string chestWeightRaw, string nettWeightRaw)
    {
        if (string.IsNullOrWhiteSpace(mfCode) || string.IsNullOrWhiteSpace(sellingMark)) return null;
        var chests = ParseDecimal(chestsRaw);
        var chestWeight = ParseDecimal(chestWeightRaw);
        var nettWeight = ParseDecimal(nettWeightRaw);
        if (nettWeight <= 0) return null;

        return new Lot
        {
            Broker = broker,
            SaleNo = saleNo.ToString(),
            Factory = NormalizeFactoryCode(mfCode),
            Mark = mfCode.Trim().ToUpperInvariant(),
            SellingMark = sellingMark.Trim().ToUpperInvariant(),
            Grade = grade.Trim(),
            Bags = (int)chests,
            NetWeight = nettWeight,
            IsReprint = IsReprint(nettWeight, chests, chestWeight),
        };
    }

    /// <summary>Row 0 is a blank spacer in every raw broker file sampled; real data starts at
    /// row 1 for all of them.</summary>
    private const int FirstDataRow = 1;

    public static List<Lot> ParseAeb(List<List<string>> rows, int saleNo)
    {
        // Broker,Year,SaleNo,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,ChestWt,NettWt,GrossWt,Category,Stores,PackCode
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 11) continue;
            var lot = BuildLot(BrokerCode.Aeb, saleNo, row[4], row[5], row[7], row[8], row[9], row[10]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseBc(List<List<string>> rows, int saleNo)
    {
        // Broker,Year,SaleNo,LotNo,MFCode,SellingMark,(blank),InvoiceNo,Grade,Chests,ChestWt,NettWt,GrossWt,Category,StoreDesc
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) continue;
            var lot = BuildLot(BrokerCode.Bc, saleNo, row[4], row[5], row[8], row[9], row[10], row[11]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseJk(List<List<string>> rows, int saleNo)
    {
        // LotNo,MFCode,SellingMark,(blank),InvoiceNo,(code),Grade,Chests,ChestWt,(flag),(0),NettWt,...
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) continue;
            var lot = BuildLot(BrokerCode.Jk, saleNo, row[1], row[2], row[6], row[7], row[8], row[11]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseLcbl(List<List<string>> rows, int saleNo)
    {
        // LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,(code),(0),NettWt,Category
        // Interleaved section-divider rows (e.g. a lone "EX-ESTATE"/"Wt/Chs" in column 0 with
        // everything else blank) are not lots — skip any row whose LotNo isn't numeric.
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 11 || !int.TryParse(row[0].Trim(), out _)) continue;
            var lot = BuildLot(BrokerCode.Lcbl, saleNo, row[1], row[2], row[4], row[5], row[7], row[10]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseMb(List<List<string>> rows, int saleNo)
    {
        // Broker,SaleNo,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,NettWt,Category
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) continue;
            var lot = BuildLot(BrokerCode.Mb, saleNo, row[4], row[5], row[7], row[8], row[10], row[11]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseFw(List<List<string>> rows, int saleNo)
    {
        // Broker,SaleNo,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,NettWt,(flag),Category,(number)
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) continue;
            var lot = BuildLot(BrokerCode.Fw, saleNo, row[4], row[5], row[7], row[8], row[10], row[11]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    public static List<Lot> ParseCtb(List<List<string>> rows, int saleNo)
    {
        // BrokerSaleNoCombined,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,(status),(0),NettWt,Warehouse,Category
        var lots = new List<Lot>();
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 13) continue;
            var lot = BuildLot(BrokerCode.Ctb, saleNo, row[3], row[4], row[6], row[7], row[9], row[12]);
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    /// <summary>ASC's own file already carries proper headers matching CatalogueImportService's
    /// generic FieldPatterns (Broker/Mark/SellingMark/Grade/NoOfChests/WeightPerChest/NettWeight
    /// etc. — see AScat362026xls.xls) — no bespoke positional parser needed, reuse the shared
    /// header-based extraction the rest of the app already uses for /data/sales files. Reprint
    /// is still inferred the same weight-mismatch way, since this raw file has no RP column either
    /// (only the app's own enriched /data/sales export does).</summary>
    public static List<Lot> ParseAsc(CatalogueImportService importer, List<List<string>> rows, int saleNo)
    {
        var parsed = ExtractTableViaHeaderRow(importer, rows);
        var lots = new List<Lot>();
        foreach (var row in parsed)
        {
            var lot = BuildLot(
                BrokerCode.Asc,
                saleNo,
                row.GetValueOrDefault("Mark", ""),
                row.GetValueOrDefault("SellingMark", ""),
                row.GetValueOrDefault("Grade", ""),
                row.GetValueOrDefault("NoOfChests", ""),
                row.GetValueOrDefault("WeightPerChest", ""),
                row.GetValueOrDefault("NettWeight", ""));
            if (lot is not null) lots.Add(lot);
        }
        return lots;
    }

    private static List<Dictionary<string, string>> ExtractTableViaHeaderRow(CatalogueImportService importer, List<List<string>> rows)
    {
        // AScat*.xls' own header row uses this app's already-recognized field names directly
        // (Mark, SellingMark, Grade, NoOfChests, WeightPerChest, NettWeight, ...) rather than
        // the free-text broker-catalogue headers CatalogueImportService.FieldPatterns matches
        // fuzzily — a straight header->index lookup is simpler and exact for this one file.
        var headerRowIdx = rows.FindIndex(r => r.Contains("SellingMark"));
        if (headerRowIdx < 0) return [];
        var headers = rows[headerRowIdx];
        var result = new List<Dictionary<string, string>>();
        for (var r = headerRowIdx + 1; r < rows.Count; r++)
        {
            var row = rows[r];
            var dict = new Dictionary<string, string>();
            for (var c = 0; c < headers.Count && c < row.Count; c++)
                if (!string.IsNullOrWhiteSpace(headers[c])) dict[headers[c]] = row[c];
            result.Add(dict);
        }
        return result;
    }

    public static List<Lot> Parse(string brokerCode, CatalogueImportService importer, List<List<string>> rows, int saleNo) => brokerCode switch
    {
        BrokerCode.Asc => ParseAsc(importer, rows, saleNo),
        BrokerCode.Aeb => ParseAeb(rows, saleNo),
        BrokerCode.Bc => ParseBc(rows, saleNo),
        BrokerCode.Jk => ParseJk(rows, saleNo),
        BrokerCode.Lcbl => ParseLcbl(rows, saleNo),
        BrokerCode.Mb => ParseMb(rows, saleNo),
        BrokerCode.Fw => ParseFw(rows, saleNo),
        BrokerCode.Ctb => ParseCtb(rows, saleNo),
        _ => throw new ArgumentException($"Unknown broker code '{brokerCode}'.", nameof(brokerCode)),
    };
}
