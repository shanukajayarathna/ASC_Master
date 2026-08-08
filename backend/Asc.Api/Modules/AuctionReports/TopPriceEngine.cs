using Asc.Api.Models;

namespace Asc.Api.Modules.AuctionReports;

/// <summary>
/// Port of the "AVG and Top Prize" legacy app's report-common.js ranking engine, operating on
/// real Lot.PurchasedPrice/Status/Category/Elevation data (every broker's lots in a sale) instead
/// of a manually-uploaded Excel export. Computes, per grade: who held 1st/2nd/3rd price, and
/// whether Asia Siyaka (OurBroker) was among them — the "Top Prices" / "Combined Report" concept.
/// </summary>
public class TopPriceEngine
{
    public const string OurBroker = "ASC";

    // Canonical grade display order — mirrors report-common.js MAIN_GRADE_ORDER exactly.
    public static readonly string[] MainGradeOrder =
    [
        "BOP", "BOPSp", "BOPF", "BOPFSp", "BOPA", "FBOP", "FBOP1", "FBOPF", "FBOPF1",
        "OP", "OPA", "OP1", "BOP1", "PEK", "PEK1",
    ];

    public static readonly string[] PremiumFloweryGradeOrder = ["FBOPFExSp", "FBOPFExSp1", "FBOPFSp"];

    // Selling-mark (estate) lists deciding Nuwara Eliya / Udupussellawa membership.
    public static readonly string[] NeMarks = ["KENMARE", "MAHAGASTOTTE", "COURT LODGE", "LOVERS LEAP", "TOMMOGONG"];
    public static readonly string[] UpMarks =
    [
        "DELMAR", "BROOKSIDE", "GONAPITIYA", "BLAIRLOMOND", "MOOLOYA", "KIRKLEES",
        "LUCKYLAND", "GAMPAHA", "GORDON", "LIDDESDALE", "HIGH FOREST", "RAGALLA", "ALMA",
    ];

    public static readonly string[] CtcGrades = ["BP1", "BPS", "OF", "PD", "PF", "PF1"];
    public static readonly string[] OffGrades = ["BOP1A", "BM", "BP", "BT", "FGS", "FGS1", "PF"];
    public static readonly string[] DustGrades = ["DUST1", "DUST", "PD"];

    private static readonly HashSet<string> NonTopPriceGrades =
        new(CtcGrades.Concat(OffGrades).Concat(DustGrades).Select(NormalizeKey));

    // ---- normalization & row predicates (mirror report-common.js) --------------------

    private static string NormalizeKey(string? value) =>
        new([.. (value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    public static bool IsOutsold(Lot lot)
    {
        var s = NormalizeKey(lot.Status);
        return s is "out" or "os" || s.StartsWith("outsold");
    }

    public static bool IsSold(Lot lot)
    {
        var s = NormalizeKey(lot.Status);
        if (s.Length == 0) return false;
        return s is "s" or "sld" || s.StartsWith("sold");
    }

    public static bool IsTopPriceGrade(Lot lot) => !NonTopPriceGrades.Contains(NormalizeKey(lot.Grade));

    public static bool IsOffGradesOrDustCategory(Lot lot)
    {
        var c = NormalizeKey(lot.Category);
        if (c.Length == 0) return false;
        return c.Contains("offgrade") || c.Contains("bop1a") || c.Contains("dust");
    }

    // isOffGradesOrDustCategory is checked first and wins — compound section names like
    // "EX-ESTATE OFFGRADE/DUST" contain both "estate" and "dust", and the off-grade/dust
    // markers are the more specific, decisive ones (see report-common.js's own comment).
    public static bool IsHighMediumOrExEstate(Lot lot)
    {
        if (IsOffGradesOrDustCategory(lot)) return false;
        var c = NormalizeKey(lot.Category);
        if (c.Length == 0) return false;
        return c.Contains("exestate") || c.Contains("estate")
            || (c.Contains("high") && c.Contains("medium"))
            || c is "hm" or "handm" or "ee";
    }

    public static bool IsLowGrownCategory(Lot lot)
    {
        var c = NormalizeKey(lot.Category);
        if (c.Length == 0) return false;
        return (c.Contains("leafy") || c.Contains("tippy")) && NormalizeKey(lot.Elevation) == "l";
    }

    public static bool IsPremiumFloweryCategory(Lot lot)
    {
        var c = NormalizeKey(lot.Category);
        if (c.Length == 0) return false;
        return c.Contains("premiumflowery") || (c.Contains("premium") && c.Contains("flowery"));
    }

    public static List<Lot> FilterRowsByMarks(IEnumerable<Lot> rows, string[] markList)
    {
        var normMarks = markList.Select(NormalizeKey).ToArray();
        return rows.Where(r =>
        {
            var mark = NormalizeKey(r.SellingMark);
            return mark.Length > 0 && normMarks.Any(m => mark == m || mark.StartsWith(m));
        }).ToList();
    }

    /// <summary>Only filters when the sale actually carries Status data at all — a sale with no
    /// Status column populated keeps every row, same fallback as the legacy app.</summary>
    public static (List<Lot> Sold, int NotSoldCount) ScopeToSold(IEnumerable<Lot> rows)
    {
        var list = rows.ToList();
        var hasStatus = list.Any(r => !string.IsNullOrWhiteSpace(r.Status));
        if (!hasStatus) return (list, 0);
        var sold = list.Where(IsSold).ToList();
        return (sold, list.Count - sold.Count);
    }

    /// <summary>Only filters when the sale carries Category data at all — a category-less sale
    /// (or a file that's already scoped to one section) passes every row through untouched.</summary>
    private static List<Lot> ScopeByCategory(List<Lot> rows, Func<Lot, bool> predicate)
    {
        var hasCategory = rows.Any(r => !string.IsNullOrWhiteSpace(r.Category));
        return hasCategory ? rows.Where(predicate).ToList() : rows;
    }

    private static bool PricesEqual(decimal a, decimal b) => Math.Abs(a - b) < 0.005m;

    private static string Ordinal(int n)
    {
        var j = n % 10;
        var k = n % 100;
        if (j == 1 && k != 11) return $"{n}st";
        if (j == 2 && k != 12) return $"{n}nd";
        if (j == 3 && k != 13) return $"{n}rd";
        return $"{n}th";
    }

    // ---- the ranking algorithm itself (port of computeTopPriceRows) ------------------

    public sealed record RankedRow(Lot Lot, int Rank, bool Highlight, string? Remark);

    private sealed record TopPriceResult(List<RankedRow> Items, string Bucket);

    private static TopPriceResult ComputeTopPriceRows(List<Lot> groupRows)
    {
        if (groupRows.Count == 0) return new TopPriceResult([], "absent");
        var ascKey = NormalizeKey(OurBroker);

        var sorted = groupRows.OrderByDescending(r => r.PurchasedPrice ?? 0m).ToList();
        var levels = new List<(decimal Price, List<Lot> Rows)>();
        foreach (var r in sorted)
        {
            var price = r.PurchasedPrice ?? 0m;
            if (levels.Count > 0 && PricesEqual(levels[^1].Price, price)) levels[^1].Rows.Add(r);
            else levels.Add((price, [r]));
        }

        // Only the top 3 places are ever checked — the 4th place is out of scope.
        var maxRank = Math.Min(3, levels.Count);
        var lastAscRank = -1;
        for (var rank = 1; rank <= maxRank; rank++)
        {
            if (levels[rank - 1].Rows.Any(r => NormalizeKey(r.Broker) == ascKey)) lastAscRank = rank;
        }

        var items = new List<RankedRow>();
        if (lastAscRank == -1)
        {
            // ASC isn't in the top 3 for this grade — keep only the outright top price.
            items.AddRange(levels[0].Rows.Select(r => new RankedRow(r, 1, false, null)));
            return new TopPriceResult(items, "absent");
        }

        // Show every level from 1st place down to the LAST place ASC appears at.
        for (var rank = 1; rank <= lastAscRank; rank++)
        {
            foreach (var r in levels[rank - 1].Rows)
            {
                var isAsc = NormalizeKey(r.Broker) == ascKey;
                var remark = isAsc ? (rank == 1 ? "Top price" : $"ASC – {Ordinal(rank)} place") : null;
                items.Add(new RankedRow(r, rank, isAsc, remark));
            }
        }

        var ascHasTop = levels[0].Rows.Any(r => NormalizeKey(r.Broker) == ascKey);
        return new TopPriceResult(items, ascHasTop ? "top" : "top4");
    }

    // ---- grouping/scoping helpers (port of buildGradeBlock etc.) ----------------------

    public sealed class Stats
    {
        public int Top, Top4, Absent, Total, Rows, Outsold;
    }

    public sealed record GradeBlock(string Grade, List<RankedRow> Items);
    public sealed record ReportBlock(string Title, List<GradeBlock> Grades);

    public static ReportBlock BuildGradeBlock(IEnumerable<Lot> rows, string title, Stats stats, string[]? canonicalOrder = null)
    {
        var list = rows.ToList();
        var neglectedOutsold = list.Count(IsOutsold);
        stats.Outsold += neglectedOutsold;
        list = list.Where(r => !IsOutsold(r)).ToList();
        if (list.Count == 0) return new ReportBlock(title, []);

        var blocks = new List<GradeBlock>();
        // GroupBy preserves first-seen order for both groups and members, matching the legacy
        // app's groupByOrdered.
        foreach (var g in list.GroupBy(r => string.IsNullOrWhiteSpace(r.Grade) ? "(No grade)" : r.Grade!))
        {
            var result = ComputeTopPriceRows([.. g]);
            stats.Total++;
            switch (result.Bucket)
            {
                case "top": stats.Top++; break;
                case "top4": stats.Top4++; break;
                default: stats.Absent++; break;
            }
            stats.Rows += g.Count();
            blocks.Add(new GradeBlock(g.Key, result.Items));
        }

        return new ReportBlock(title, SortGradesByCanonicalOrder(blocks, canonicalOrder));
    }

    private static List<GradeBlock> SortGradesByCanonicalOrder(List<GradeBlock> grades, string[]? canonicalOrder)
    {
        if (canonicalOrder is null || canonicalOrder.Length == 0) return grades;
        var rank = canonicalOrder.Select((g, i) => (Key: NormalizeKey(g), Index: i)).ToDictionary(x => x.Key, x => x.Index);
        return [.. grades
            .Select((g, i) => (Grade: g, Index: i, Rank: rank.TryGetValue(NormalizeKey(g.Grade), out var r) ? r : int.MaxValue))
            .OrderBy(x => x.Rank).ThenBy(x => x.Index)
            .Select(x => x.Grade)];
    }

    public static List<ReportBlock> BuildElevationBlocks(IEnumerable<Lot> rows, string[] elevationCodes, Stats stats, string[]? canonicalOrder = null)
    {
        var list = rows.ToList();
        return [.. elevationCodes.Select(code =>
            BuildGradeBlock(list.Where(r => NormalizeKey(r.Elevation) == NormalizeKey(code)), code, stats, canonicalOrder))];
    }

    public static ReportBlock BuildGradeListBlock(IEnumerable<Lot> rows, string[] gradeList, string title, Stats stats, string[]? canonicalOrder = null)
    {
        var normSet = new HashSet<string>(gradeList.Select(NormalizeKey));
        var subset = rows.Where(r => normSet.Contains(NormalizeKey(r.Grade)));
        return BuildGradeBlock(subset, title, stats, canonicalOrder ?? gradeList);
    }

    public static List<ReportBlock> BuildGradeListBlocksByElevation(IEnumerable<Lot> rows, string[] gradeList, Stats stats, string[]? canonicalGradeOrder = null)
    {
        var normSet = new HashSet<string>(gradeList.Select(NormalizeKey));
        var subset = rows.Where(r => normSet.Contains(NormalizeKey(r.Grade)));
        return [.. subset
            .GroupBy(r => string.IsNullOrWhiteSpace(r.Elevation) ? "(No Elevation)" : r.Elevation!)
            .Select(g => BuildGradeBlock(g, g.Key, stats, canonicalGradeOrder ?? gradeList))];
    }

    // ---- top-level report assembly (port of combined.js's generateReport) -------------

    private sealed record AllReports(AuctionReportDto TopPrices, AuctionReportDto Ctc, AuctionReportDto OffGradesDust, AuctionReportDto LowGrownPremiumFlowery);

    public static readonly string[] ReportKeys = ["top-prices", "ctc", "off-grades-dust", "low-grown-premium-flowery"];

    public AuctionReportDto? Build(string reportKey, List<Lot> lots, string sourceName)
    {
        var all = BuildAll(lots, sourceName);
        return reportKey switch
        {
            "top-prices" => all.TopPrices,
            "ctc" => all.Ctc,
            "off-grades-dust" => all.OffGradesDust,
            "low-grown-premium-flowery" => all.LowGrownPremiumFlowery,
            _ => null,
        };
    }

    public CombinedReportDto BuildCombined(List<Lot> lots, string sourceName)
    {
        var all = BuildAll(lots, sourceName);
        return new CombinedReportDto(sourceName, DateTime.UtcNow, [all.TopPrices, all.Ctc, all.OffGradesDust, all.LowGrownPremiumFlowery]);
    }

    private static AllReports BuildAll(List<Lot> lots, string sourceName)
    {
        var now = DateTime.UtcNow;
        var (soldRows, _) = ScopeToSold(lots);

        // ---- Top Prices (UH, UM & WH, WM; Nuwara Eliya & Udupussellawa) ----
        var hmeRows = ScopeByCategory(soldRows, IsHighMediumOrExEstate);
        var tpRows = hmeRows.Where(IsTopPriceGrade).ToList();
        var neRows = FilterRowsByMarks(tpRows, NeMarks);
        var upRows = FilterRowsByMarks(tpRows, UpMarks);
        var neUpSet = new HashSet<Lot>(neRows.Concat(upRows));
        var elevationRows = tpRows.Where(r => !neUpSet.Contains(r)).ToList();

        var tpStats = new Stats();
        var tpSheets = new List<AuctionReportSheetDto>
        {
            ToSheetDto("UH & UM", true, BuildElevationBlocks(elevationRows, ["UH", "UM"], tpStats, MainGradeOrder)),
            ToSheetDto("WH & WM", true, BuildElevationBlocks(elevationRows, ["WH", "WM"], tpStats, MainGradeOrder)),
            ToSheetDto("Nuwara Eliya & Udupussellawa", false,
            [
                BuildGradeBlock(neRows, "Nuwara Eliya", tpStats, MainGradeOrder),
                BuildGradeBlock(upRows, "Udupussellawa", tpStats, MainGradeOrder),
            ]),
        };
        var topPrices = new AuctionReportDto("top-prices", "Top Prices — UH, UM & WH, WM", sourceName, now, ToStatsDto(tpStats), tpSheets);

        // ---- CTC ----
        var ctcStats = new Stats();
        var ctcSheet = ToSheetDto("CTC", true, BuildGradeListBlocksByElevation(hmeRows, CtcGrades, ctcStats));
        var ctc = new AuctionReportDto("ctc", "CTC Report", sourceName, now, ToStatsDto(ctcStats), [ctcSheet]);

        // ---- Off Grades & Dust ----
        var ogdRows = ScopeByCategory(soldRows, IsOffGradesOrDustCategory);
        var ogdStats = new Stats();
        var ogdSheet = ToSheetDto("Off Grades & Dust", false,
        [
            BuildGradeListBlock(ogdRows, OffGrades, "Off Grades", ogdStats),
            BuildGradeListBlock(ogdRows, DustGrades, "Dust", ogdStats),
        ]);
        var ogd = new AuctionReportDto("off-grades-dust", "Off Grades & Dust Report", sourceName, now, ToStatsDto(ogdStats), [ogdSheet]);

        // ---- Low Grown & Premium Flowery ----
        var lgPfStats = new Stats();
        var lowGrownRows = ScopeByCategory(soldRows, IsLowGrownCategory);
        var pfRows = ScopeByCategory(soldRows, IsPremiumFloweryCategory);
        var lgPfSheets = new List<AuctionReportSheetDto>
        {
            ToSheetDto("Low Grown", false, [BuildGradeBlock(lowGrownRows, "Low Grown", lgPfStats, MainGradeOrder)]),
            ToSheetDto("Premium Flowery", false, [BuildGradeBlock(pfRows, "Premium Flowery", lgPfStats, PremiumFloweryGradeOrder)]),
        };
        var lgPf = new AuctionReportDto("low-grown-premium-flowery", "Low Grown & Premium Flowery Report", sourceName, now, ToStatsDto(lgPfStats), lgPfSheets);

        return new AllReports(topPrices, ctc, ogd, lgPf);
    }

    private static AuctionReportSheetDto ToSheetDto(string title, bool includeElevation, List<ReportBlock> blocks) =>
        new(title, includeElevation, [.. blocks.Select(b => new ReportBlockDto(b.Title, [.. b.Grades.Select(g => new GradeBlockDto(g.Grade, [.. g.Items.Select(ToRowDto)]))]))]);

    private static RankedLotRowDto ToRowDto(RankedRow r) => new(
        r.Rank,
        r.Lot.Broker ?? "(unspecified)",
        r.Lot.SellingMark ?? "",
        r.Lot.Grade ?? "",
        r.Lot.Elevation,
        r.Lot.PurchasedPrice ?? 0m,
        r.Lot.Buyer,
        r.Lot.BuyerName,
        r.Highlight,
        r.Remark);

    private static AuctionReportStatsDto ToStatsDto(Stats s) => new(s.Top, s.Top4, s.Absent, s.Total, s.Rows, s.Outsold);
}
