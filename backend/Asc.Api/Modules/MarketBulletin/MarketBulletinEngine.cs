using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Builds the Weekly Market Bulletin: per grade, the four Valuation Centre price tiers (see
/// TierSplitter), merged into the row layout each section actually uses (flat 4-row, elevation-
/// banded 10-row for High and Medium, elevation-banded 12-row for Dust, or 2-row for
/// Unorthodox), for this sale side by side with the immediately preceding one.
///
/// Section membership/order follows MarketBulletinGrades' own doc comment: grade lists were
/// built from the real Category column real sale files carry, but membership here is still
/// decided by exact Grade string + Elevation code (LotsForFamily + elevation predicates) rather
/// than reading Lot.Category live, because Category alone does not cleanly separate by
/// elevation in real data. Ex-estate is the one section that reads Lot.Category directly (see
/// BuildExEstate) — it has no elevation restriction, and the user wants "whatever's really
/// there, alphabetically" rather than a fixed grade list.
/// </summary>
public static class MarketBulletinEngine
{
    public static MarketBulletinDto Build(
        List<Lot> thisWeekLots, List<Lot>? lastWeekLots, string sourceName, string? previousSourceName)
    {
        var thisWeek = TopPriceEngine.ScopeToSold(thisWeekLots).Sold;
        var lastWeek = lastWeekLots is null ? [] : TopPriceEngine.ScopeToSold(lastWeekLots).Sold;

        var sections = new List<BulletinSectionDto>
        {
            BuildLowGrown(thisWeek, lastWeek),
            BuildFlatFourRowSection("Premium Flowery", MarketBulletinGrades.PremiumFloweryGrades, thisWeek, lastWeek, null),
            BuildFlatFourRowSection("Off Grade", MarketBulletinGrades.OffGradeGrades, thisWeek, lastWeek, null),
            BuildDust(thisWeek, lastWeek),
            BuildHighAndMedium(thisWeek, lastWeek),
            BuildUnorthodox(thisWeek, lastWeek),
            BuildExEstate(thisWeek, lastWeek),
        };

        return new MarketBulletinDto(sourceName, previousSourceName, DateTime.UtcNow, sections);
    }

    // ---- elevation/grade helpers -------------------------------------------------------

    private static string NormGrade(string? g) => (g ?? "").Trim().ToUpperInvariant();
    private static string NormElevation(string? e) => (e ?? "").Trim().ToUpperInvariant();

    private static bool IsHighElevation(Lot l) => NormElevation(l.Elevation) is "WH" or "UH";
    private static bool IsMediumElevation(Lot l) => NormElevation(l.Elevation) is "WM" or "UM";
    private static bool IsLowElevation(Lot l) => NormElevation(l.Elevation) == "L";

    private static List<Lot> LotsForFamily(List<Lot> pool, string[] grades)
    {
        var set = new HashSet<string>(grades.Select(NormGrade));
        return pool.Where(l => set.Contains(NormGrade(l.Grade))).ToList();
    }

    private static PriceRangeDto ToDto(TierSplitter.PriceRange r, decimal totalQuantityKg) =>
        new(r.Min, r.Max, r.LotCount, totalQuantityKg > 0 ? Math.Round(r.QuantityKg / totalQuantityKg * 100m, 1) : null);

    /// <summary>Denominator for QuantityPct — the grade's whole priced, sold quantity for that
    /// week, filtered the same way TierSplitter.SliceFourTiers filters before cutting into
    /// tiers (PurchasedPrice must be set), so a tier's percentage share is always taken against
    /// the same population it was cut from rather than a mismatched, unfiltered total.</summary>
    private static decimal TotalQuantityKg(List<Lot> lots) =>
        lots.Where(l => l.PurchasedPrice.HasValue).Sum(l => l.NetWeight ?? 0m);

    private static BulletinRowDto BuildRow(string label, List<Lot> thisWeek, List<Lot> lastWeek, int[] tierIndices)
    {
        var tw = TierSplitter.Merge(TierSplitter.ComputeFourTiers(thisWeek), tierIndices);
        var lw = TierSplitter.Merge(TierSplitter.ComputeFourTiers(lastWeek), tierIndices);
        return new BulletinRowDto(label, ToDto(tw, TotalQuantityKg(thisWeek)), ToDto(lw, TotalQuantityKg(lastWeek)));
    }

    private static readonly int[] TopTwoTiers = [TierSplitter.SelectBest, TierSplitter.Best];
    private static readonly int[] BottomTwoTiers = [TierSplitter.BelowBest, TierSplitter.Poor];

    // ---- Low Grown (one section, 3 labeled sub-groups) / Premium Flowery / Off Grade -------

    /// <summary>Low Grown is ONE section — "Low Grown — Leafy" as three separate top-level
    /// sections was the first attempt, but Leafy/Semi Leafy/Tippy only ever mean Low Grown in
    /// this report, so the prefix was redundant. Leafy/Semi Leafy/Tippy are now sub-group
    /// labels on the tables themselves (see BulletinTableDto's own doc comment) within a single
    /// "Low Grown" section, in that order.</summary>
    private static BulletinSectionDto BuildLowGrown(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        AddFlatFourRowTables(tables, "Leafy", MarketBulletinGrades.LeafyGrades, thisWeek, lastWeek, IsLowElevation);
        AddFlatFourRowTables(tables, "Semi Leafy", MarketBulletinGrades.SemiLeafyGrades, thisWeek, lastWeek, IsLowElevation);
        AddFlatFourRowTables(tables, "Tippy", MarketBulletinGrades.TippyGrades, thisWeek, lastWeek, IsLowElevation);
        return new BulletinSectionDto("Low Grown", tables);
    }

    /// <summary>One table per grade, the classic Select Best/Best/Below Best/Poor 4-row shape
    /// — shared by Low Grown's Leafy/Semi Leafy/Tippy sub-groups (elevationFilter =
    /// IsLowElevation), Premium Flowery, and Off Grade (elevationFilter = null, no elevation
    /// restriction — real data shows both span every elevation band).</summary>
    private static BulletinSectionDto BuildFlatFourRowSection(
        string title, string[] grades, List<Lot> thisWeek, List<Lot> lastWeek, Func<Lot, bool>? elevationFilter)
    {
        var tables = new List<BulletinTableDto>();
        AddFlatFourRowTables(tables, null, grades, thisWeek, lastWeek, elevationFilter);
        return new BulletinSectionDto(title, tables);
    }

    private static void AddFlatFourRowTables(
        List<BulletinTableDto> tables, string? groupLabel, string[] grades, List<Lot> thisWeek, List<Lot> lastWeek, Func<Lot, bool>? elevationFilter)
    {
        foreach (var grade in grades)
        {
            var tw = LotsForFamily(thisWeek, [grade]);
            var lw = LotsForFamily(lastWeek, [grade]);
            if (elevationFilter is not null)
            {
                tw = tw.Where(elevationFilter).ToList();
                lw = lw.Where(elevationFilter).ToList();
            }
            var rows = new List<BulletinRowDto>
            {
                BuildRow("Select Best", tw, lw, [TierSplitter.SelectBest]),
                BuildRow("Best", tw, lw, [TierSplitter.Best]),
                BuildRow("Below Best", tw, lw, [TierSplitter.BelowBest]),
                BuildRow("Poor", tw, lw, [TierSplitter.Poor]),
            };
            tables.Add(new BulletinTableDto(grade, rows, groupLabel));
        }
    }

    // ---- Dust: one table per grade, Low/Medium/High elevation as row-groups ---------------

    private static readonly (string Label, Func<Lot, bool> Filter)[] DustElevationBands =
    [
        ("Low", IsLowElevation),
        ("Medium", IsMediumElevation),
        ("High", IsHighElevation),
    ];

    /// <summary>Each Dust grade (PD, DUST1, DUST) gets its own table with all 3 elevation
    /// bands as row-groups (Low/Medium/High, in that order — the user's own stated order),
    /// each band showing the full 4-tier breakdown — 12 rows per table. Plain elevation-
    /// prefixed row labels (e.g. "Low Select Best") are the same convention this report
    /// already used for elevation rows before this restructure — no new DTO field needed.</summary>
    private static BulletinSectionDto BuildDust(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var grade in MarketBulletinGrades.DustGrades)
        {
            var tw = LotsForFamily(thisWeek, [grade]);
            var lw = LotsForFamily(lastWeek, [grade]);
            var rows = new List<BulletinRowDto>();
            foreach (var (bandLabel, filter) in DustElevationBands)
            {
                var twBand = tw.Where(filter).ToList();
                var lwBand = lw.Where(filter).ToList();
                rows.Add(BuildRow($"{bandLabel} Select Best", twBand, lwBand, [TierSplitter.SelectBest]));
                rows.Add(BuildRow($"{bandLabel} Best", twBand, lwBand, [TierSplitter.Best]));
                rows.Add(BuildRow($"{bandLabel} Below Best", twBand, lwBand, [TierSplitter.BelowBest]));
                rows.Add(BuildRow($"{bandLabel} Poor", twBand, lwBand, [TierSplitter.Poor]));
            }
            tables.Add(new BulletinTableDto(grade, rows));
        }
        return new BulletinSectionDto("Dust", tables);
    }

    // ---- High and Medium: same 15 grades/order as Low Grown, flat 4-row — no mark/elevation split ----

    private static bool IsHighOrMediumElevation(Lot l) => IsHighElevation(l) || IsMediumElevation(l);

    /// <summary>One table per grade, the same flat Select Best/Best/Below Best/Poor 4-row shape
    /// as Low Grown/Premium Flowery/Off Grade/Ex-estate — applied across all 15 grades in Low
    /// Grown's own Leafy+Semi Leafy+Tippy order (real data confirms High and Medium's raw
    /// Category is exactly this same set of grades, just at high/medium elevation instead of
    /// low) rather than just BOP/BOPF. An earlier version of this section split each grade by
    /// Westerns/Uva/Nuwara Eliya/Udapussellawa/Medium (mirroring the old separate High Grown/
    /// Medium Grown builders) — the user explicitly asked to drop that: no Uva/Westerns/etc.
    /// distinction here, just the same 4 classifications every other flat section uses. Not
    /// split into Leafy/Semi Leafy/Tippy sub-groups either (GroupLabel stays null for every
    /// table here — see BulletinTableDto's own doc comment).</summary>
    private static BulletinSectionDto BuildHighAndMedium(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var grades = MarketBulletinGrades.LeafyGrades
            .Concat(MarketBulletinGrades.SemiLeafyGrades)
            .Concat(MarketBulletinGrades.TippyGrades)
            .ToArray();

        var tables = new List<BulletinTableDto>();
        AddFlatFourRowTables(tables, null, grades, thisWeek, lastWeek, IsHighOrMediumElevation);
        return new BulletinSectionDto("High and Medium", tables);
    }

    // ---- Unorthodox (CTC): flat 2-row per grade, no elevation restriction -----------------

    /// <summary>BP1/PF1 plus BPS/OF — the CTC-ish grades that real data otherwise tags under
    /// "High and Medium" or "Ex-estate" alongside genuinely Orthodox grades (see
    /// MarketBulletinGrades.UnorthodoxGrades) — shown here once instead of duplicated.</summary>
    private static BulletinSectionDto BuildUnorthodox(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var grade in MarketBulletinGrades.UnorthodoxGrades)
        {
            var tw = LotsForFamily(thisWeek, [grade]);
            var lw = LotsForFamily(lastWeek, [grade]);
            var rows = new List<BulletinRowDto>
            {
                BuildRow($"Best {grade}", tw, lw, TopTwoTiers),
                BuildRow($"Other {grade}", tw, lw, BottomTwoTiers),
            };
            tables.Add(new BulletinTableDto(grade, rows));
        }
        return new BulletinSectionDto("Unorthodox", tables);
    }

    // ---- Ex-estate: grouped live by Lot.Category, alphabetical, no elevation restriction ----

    /// <summary>The one section that reads Lot.Category directly instead of a fixed grade
    /// list — the user wants "whatever grades are really there this sale, alphabetically,"
    /// and Ex-estate (unlike every other category) has no elevation split to worry about.
    /// Excludes the Unorthodox grade set so BP1/BPS/OF/PF1 lots tagged Category="Ex-estate"
    /// in real data don't show up here as well as under Unorthodox.</summary>
    private static BulletinSectionDto BuildExEstate(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var excluded = new HashSet<string>(MarketBulletinGrades.UnorthodoxGrades.Select(NormGrade));
        bool IsExEstate(Lot l) =>
            string.Equals((l.Category ?? "").Trim(), "Ex-estate", StringComparison.OrdinalIgnoreCase)
            && !excluded.Contains(NormGrade(l.Grade));

        var twPool = thisWeek.Where(IsExEstate).ToList();
        var lwPool = lastWeek.Where(IsExEstate).ToList();

        var grades = twPool.Concat(lwPool)
            .Select(l => l.Grade ?? "")
            .Where(g => g.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(g => g, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var tables = new List<BulletinTableDto>();
        foreach (var grade in grades)
        {
            var tw = LotsForFamily(twPool, [grade]);
            var lw = LotsForFamily(lwPool, [grade]);
            var rows = new List<BulletinRowDto>
            {
                BuildRow("Select Best", tw, lw, [TierSplitter.SelectBest]),
                BuildRow("Best", tw, lw, [TierSplitter.Best]),
                BuildRow("Below Best", tw, lw, [TierSplitter.BelowBest]),
                BuildRow("Poor", tw, lw, [TierSplitter.Poor]),
            };
            tables.Add(new BulletinTableDto(grade, rows));
        }
        return new BulletinSectionDto("Ex-estate", tables);
    }
}
