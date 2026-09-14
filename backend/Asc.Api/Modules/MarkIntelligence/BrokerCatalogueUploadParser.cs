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
/// <summary>One broker's parse outcome: the lots that came out cleanly, plus how many data
/// rows were dropped along the way (too few columns, or a blank MF code/selling mark/nett
/// weight — see BuildLot) — surfaced to the user as a warning before generation persists
/// anything, instead of silently vanishing as before.</summary>
public readonly record struct BrokerParseResult(List<Lot> Lots, int SkippedRows);

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

    public static BrokerParseResult ParseAeb(List<List<string>> rows, int saleNo)
    {
        // Broker,Year,SaleNo,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,ChestWt,NettWt,GrossWt,Category,Stores,PackCode
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 11) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Aeb, saleNo, row[4], row[5], row[7], row[8], row[9], row[10]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseBc(List<List<string>> rows, int saleNo)
    {
        // Broker,Year,SaleNo,LotNo,MFCode,SellingMark,(blank),InvoiceNo,Grade,Chests,ChestWt,NettWt,GrossWt,Category,StoreDesc
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Bc, saleNo, row[4], row[5], row[8], row[9], row[10], row[11]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseJk(List<List<string>> rows, int saleNo)
    {
        // LotNo,MFCode,SellingMark,(blank),InvoiceNo,(code),Grade,Chests,ChestWt,(flag),(0),NettWt,...
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Jk, saleNo, row[1], row[2], row[6], row[7], row[8], row[11]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseLcbl(List<List<string>> rows, int saleNo)
    {
        // LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,(code),(0),NettWt,Category
        // Interleaved section-divider rows (e.g. a lone "EX-ESTATE"/"Wt/Chs" in column 0 with
        // everything else blank) are not lots and not a skip either — only a row that looks
        // like real data (numeric LotNo, wide enough) but still fails BuildLot counts.
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 11 || !int.TryParse(row[0].Trim(), out _)) continue;
            var lot = BuildLot(BrokerCode.Lcbl, saleNo, row[1], row[2], row[4], row[5], row[7], row[10]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseMb(List<List<string>> rows, int saleNo)
    {
        // Broker,SaleNo,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,NettWt,Category
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Mb, saleNo, row[4], row[5], row[7], row[8], row[10], row[11]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseFw(List<List<string>> rows, int saleNo)
    {
        // Broker,SaleNo,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,NettWt,(flag),Category,(number)
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 12) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Fw, saleNo, row[4], row[5], row[7], row[8], row[10], row[11]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    public static BrokerParseResult ParseCtb(List<List<string>> rows, int saleNo)
    {
        // BrokerSaleNoCombined,Date,LotNo,MFCode,SellingMark,InvoiceNo,Grade,Chests,(flag),ChestWt,(status),(0),NettWt,Warehouse,Category
        var lots = new List<Lot>();
        var skipped = 0;
        for (var r = FirstDataRow; r < rows.Count; r++)
        {
            var row = rows[r];
            if (row.Count < 13) { skipped++; continue; }
            var lot = BuildLot(BrokerCode.Ctb, saleNo, row[3], row[4], row[6], row[7], row[9], row[12]);
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
    }

    /// <summary>ASC's own file already carries proper headers matching CatalogueImportService's
    /// generic FieldPatterns (Broker/Mark/SellingMark/Grade/NoOfChests/WeightPerChest/NettWeight
    /// etc. — see AScat362026xls.xls) — no bespoke positional parser needed, reuse the shared
    /// header-based extraction the rest of the app already uses for /data/sales files. Reprint
    /// is still inferred the same weight-mismatch way, since this raw file has no RP column either
    /// (only the app's own enriched /data/sales export does).</summary>
    public static BrokerParseResult ParseAsc(CatalogueImportService importer, List<List<string>> rows, int saleNo)
    {
        var parsed = ExtractTableViaHeaderRow(importer, rows);
        var lots = new List<Lot>();
        var skipped = 0;
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
            if (lot is not null) lots.Add(lot); else skipped++;
        }
        return new BrokerParseResult(lots, skipped);
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

    public static BrokerParseResult Parse(string brokerCode, CatalogueImportService importer, List<List<string>> rows, int saleNo) => brokerCode switch
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

    /// <summary>Best-effort sale year/number/date for ONE already-identified broker's file,
    /// read from whichever columns that broker's own layout carries — not every broker
    /// carries all three (JK and LCBL carry none of them at all; ASC/AEB/BC carry year and
    /// sale number but no date; MB/FW/CTB carry sale number and an actual date, from which
    /// year is derived). Null fields mean "this broker's file doesn't say", not an error —
    /// see DetectSaleInfo for combining several brokers' files into one answer.</summary>
    public static (int? Year, int? SaleNo, DateTime? Date) TryDetectSaleInfo(string brokerCode, CatalogueImportService importer, List<List<string>> rows)
    {
        switch (brokerCode)
        {
            case BrokerCode.Asc:
            {
                // Header-based, like ParseAsc itself — "SaleYear"/"SaleNumber" are this
                // file's own header text (confirmed live), not a name this app invented.
                var parsed = ExtractTableViaHeaderRow(importer, rows);
                var first = parsed.FirstOrDefault(r => !string.IsNullOrWhiteSpace(r.GetValueOrDefault("SellingMark")));
                if (first is null) return (null, null, null);
                var year = int.TryParse(first.GetValueOrDefault("SaleYear"), out var y) ? y : (int?)null;
                var saleNo = int.TryParse(first.GetValueOrDefault("SaleNumber"), out var s) ? s : (int?)null;
                return (year, saleNo, null);
            }
            case BrokerCode.Aeb:
            case BrokerCode.Bc:
            {
                // Broker,Year,SaleNo,... for both — row[1]=Year, row[2]=SaleNo.
                for (var r = FirstDataRow; r < rows.Count; r++)
                {
                    var row = rows[r];
                    if (row.Count < 3) continue;
                    if (int.TryParse(row[1].Trim(), out var year) && int.TryParse(row[2].Trim(), out var saleNo))
                        return (year, saleNo, null);
                }
                return (null, null, null);
            }
            case BrokerCode.Mb:
            case BrokerCode.Fw:
            {
                // Broker,SaleNo,Date,... for both — row[1]=SaleNo, row[2]=Date (MB's own cell
                // is text "dd/MM/yyyy"; FW's is a real Excel date, which ParseExcel's own
                // date formatting turns into "yyyy-MM-dd" text — TryParseSaleDate tries both).
                for (var r = FirstDataRow; r < rows.Count; r++)
                {
                    var row = rows[r];
                    if (row.Count < 3) continue;
                    if (int.TryParse(row[1].Trim(), out var saleNo))
                    {
                        var date = TryParseSaleDate(row[2]);
                        return (date?.Year, saleNo, date);
                    }
                }
                return (null, null, null);
            }
            case BrokerCode.Ctb:
            {
                // Broker+SaleNo combined into one column ("CT037"), Date in the next.
                foreach (var row in rows)
                {
                    if (row.Count < 2) continue;
                    var combined = row[0].Trim().ToUpperInvariant();
                    if (combined.StartsWith("CT", StringComparison.Ordinal) && combined.Length > 2 &&
                        int.TryParse(combined[2..], out var saleNo))
                    {
                        var date = TryParseSaleDate(row[1]);
                        return (date?.Year, saleNo, date);
                    }
                }
                return (null, null, null);
            }
            default: // JK, LCBL: no Broker/Year/SaleNo/Date columns at all
                return (null, null, null);
        }
    }

    private static DateTime? TryParseSaleDate(string raw)
    {
        raw = raw.Trim();
        if (DateTime.TryParseExact(raw, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var isoDate))
            return isoDate;
        if (DateTime.TryParseExact(raw, "dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var slashDate))
            return slashDate;
        return null;
    }

    /// <summary>Combines whichever broker files are on hand (as few as one, as many as all
    /// 8 — callers use this both for a live guess as files are chosen one at a time and for
    /// the final zip-upload detection) into one best-effort sale year/number/date, plus a
    /// human-readable warning for each field the files actually disagree on (never silently
    /// picks a side when they conflict — surfaces it so the user can check). Year falls back
    /// to whatever a detected date's own year is when no file states it directly (MB/FW/CTB
    /// carry a date but not a separate year column).</summary>
    public static (int? Year, int? SaleNo, DateTime? Date, List<string> Warnings) DetectSaleInfo(
        IReadOnlyDictionary<string, List<List<string>>> rowsByBroker, CatalogueImportService importer)
    {
        var years = new HashSet<int>();
        var saleNos = new HashSet<int>();
        var dates = new HashSet<DateTime>();

        foreach (var (broker, rows) in rowsByBroker)
        {
            var (year, saleNo, date) = TryDetectSaleInfo(broker, importer, rows);
            if (year is { } y) years.Add(y);
            if (saleNo is { } s) saleNos.Add(s);
            if (date is { } d) dates.Add(d.Date);
        }

        var warnings = new List<string>();
        if (years.Count > 1) warnings.Add($"The files disagree on sale year: {string.Join(", ", years.OrderBy(x => x))}.");
        if (saleNos.Count > 1) warnings.Add($"The files disagree on sale number: {string.Join(", ", saleNos.OrderBy(x => x))}.");
        if (dates.Count > 1) warnings.Add($"The files disagree on sale date: {string.Join(", ", dates.OrderBy(x => x).Select(d => d.ToString("dd MMM yyyy")))}.");

        var finalDate = dates.Count > 0 ? dates.Min() : (DateTime?)null;
        var finalYear = years.Count > 0 ? years.Min() : finalDate?.Year;
        var finalSaleNo = saleNos.Count > 0 ? saleNos.Min() : (int?)null;
        return (finalYear, finalSaleNo, finalDate, warnings);
    }

    /// <summary>Identifies which of the 8 brokers a raw file belongs to from its own
    /// content, not its filename — filenames are inconsistent across sales (confirmed live:
    /// ASC's own file was "AScat362026xls.xls" for Sale 36 but "cat372026xls.xls" for Sale
    /// 37, with no "ASC" in the name at all), so a zip's member names can't be trusted.
    /// Six of the eight files carry their own broker code as the literal first column of
    /// every data row (confirmed live for both Sale 36 and 37: ASC="AS", AEB="EB", BC="BC",
    /// MB="MB", FW="FW", CTB="CT037"/"CT036" — a "CT" prefix followed by the sale number) —
    /// checked against the first few rows in case row 0 is a blank spacer. JK and LCBL carry
    /// no broker/year/sale columns at all (column 0 is just the numeric LotNo for both), so
    /// they're told apart from each other by row width instead — confirmed live: JK's rows
    /// run ~18 columns wide, LCBL's ~13, a wide enough gap that padding differences between
    /// sales won't close it. Returns null if nothing recognizable enough to make a
    /// call — never guesses.</summary>
    public static string? DetectBroker(List<List<string>> rows)
    {
        foreach (var row in rows.Take(6))
        {
            if (row.Count == 0) continue;
            var first = row[0].Trim().ToUpperInvariant();
            switch (first)
            {
                case "AS": return BrokerCode.Asc;
                case "EB": return BrokerCode.Aeb;
                case "BC": return BrokerCode.Bc;
                case "MB": return BrokerCode.Mb;
                case "FW": return BrokerCode.Fw;
            }
            if (first.StartsWith("CT", StringComparison.Ordinal) && first.Length > 2 && char.IsDigit(first[2]))
                return BrokerCode.Ctb;

            // Column 0 is a bare LotNo (no broker/year/sale columns at all) only for JK and
            // LCBL — row width tells them apart. A LotNo row can appear as early as row 0
            // (LCBL) or after a blank spacer (JK), so this checks every row in the window
            // rather than assuming a fixed position.
            if (int.TryParse(first, out _))
                return row.Count >= 16 ? BrokerCode.Jk : BrokerCode.Lcbl;
        }
        return null;
    }
}
