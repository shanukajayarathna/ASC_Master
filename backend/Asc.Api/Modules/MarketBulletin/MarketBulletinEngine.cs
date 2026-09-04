using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Builds the Weekly Market Bulletin: per grade (or pooled grade family), the four
/// Valuation Centre price tiers (see TierSplitter), merged into the row layout the
/// printed bulletin actually uses (flat 4-row, 3-row, 2-row, or untiered 1-row), for
/// this sale side by side with the immediately preceding one. Reuses TopPriceEngine's
/// elevation-code/mark-list vocabulary (WH/UH/WM/UM, NE/UP mark lists, ScopeToSold)
/// rather than re-deriving it; unlike TopPriceEngine's own category-text predicates
/// (IsHighMediumOrExEstate etc.), grouping here is done purely by exact Grade string +
/// Elevation code, which already disambiguates every family used below without needing
/// a Category column at all.
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
            BuildHighGrown(thisWeek, lastWeek),
            BuildMediumGrown(thisWeek, lastWeek),
            BuildUnorthodox(thisWeek, lastWeek),
            BuildHmOrthodox(thisWeek, lastWeek),
            BuildOffGrades(thisWeek, lastWeek),
            BuildDust(thisWeek, lastWeek),
            BuildLowGrown(thisWeek, lastWeek),
        };

        return new MarketBulletinDto(sourceName, previousSourceName, DateTime.UtcNow, sections);
    }

    // ---- elevation/grade helpers -------------------------------------------------------

    private static string NormGrade(string? g) => (g ?? "").Trim().ToUpperInvariant();
    private static string NormElevation(string? e) => (e ?? "").Trim().ToUpperInvariant();

    private static bool IsHighElevation(Lot l) => NormElevation(l.Elevation) is "WH" or "UH";
    private static bool IsMediumElevation(Lot l) => NormElevation(l.Elevation) is "WM" or "UM";
    private static bool IsLowElevation(Lot l) => NormElevation(l.Elevation) == "L";
    private static bool IsWestern(Lot l) => NormElevation(l.Elevation) == "WH";
    private static bool IsUva(Lot l) => NormElevation(l.Elevation) == "UH";

    private static List<Lot> LotsForFamily(List<Lot> pool, string[] grades)
    {
        var set = new HashSet<string>(grades.Select(NormGrade));
        return pool.Where(l => set.Contains(NormGrade(l.Grade))).ToList();
    }

    private static PriceRangeDto ToDto(TierSplitter.PriceRange r) => new(r.Min, r.Max, r.LotCount);

    private static BulletinRowDto BuildRow(string label, List<Lot> thisWeek, List<Lot> lastWeek, int[] tierIndices)
    {
        var tw = TierSplitter.Merge(TierSplitter.ComputeFourTiers(thisWeek), tierIndices);
        var lw = TierSplitter.Merge(TierSplitter.ComputeFourTiers(lastWeek), tierIndices);
        return new BulletinRowDto(label, ToDto(tw), ToDto(lw));
    }

    private static readonly int[] AllTiers = [TierSplitter.SelectBest, TierSplitter.Best, TierSplitter.BelowBest, TierSplitter.Poor];
    private static readonly int[] TopTwoTiers = [TierSplitter.SelectBest, TierSplitter.Best];
    private static readonly int[] BottomTwoTiers = [TierSplitter.BelowBest, TierSplitter.Poor];

    // ---- High Grown: Westerns(3-row) / Nuwara Eliya(1-row) / Udapussellawa(2-row) / Uva(2-row) ----

    private static BulletinSectionDto BuildHighGrown(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.HighMediumGrown)
        {
            var tw = LotsForFamily(thisWeek, family.Grades).Where(IsHighElevation).ToList();
            var lw = LotsForFamily(lastWeek, family.Grades).Where(IsHighElevation).ToList();

            var (twWesterns, twUva, twNe, twUp) = SplitHighGrownMarkGroups(tw);
            var (lwWesterns, lwUva, lwNe, lwUp) = SplitHighGrownMarkGroups(lw);

            var rows = new List<BulletinRowDto>
            {
                BuildRow("Best Westerns", twWesterns, lwWesterns, TopTwoTiers),
                BuildRow("Below Best Westerns", twWesterns, lwWesterns, [TierSplitter.BelowBest]),
                BuildRow("Other Westerns", twWesterns, lwWesterns, [TierSplitter.Poor]),
                BuildRow("Nuwara Eliya", twNe, lwNe, AllTiers),
                BuildRow("Brighter Udapussellawa", twUp, lwUp, TopTwoTiers),
                BuildRow("Other Udapussellawa", twUp, lwUp, BottomTwoTiers),
                BuildRow("Best Uva", twUva, lwUva, TopTwoTiers),
                BuildRow("Other Uva", twUva, lwUva, BottomTwoTiers),
            };
            tables.Add(new BulletinTableDto(family.Label, rows));
        }
        return new BulletinSectionDto("High Grown", tables);
    }

    private static (List<Lot> Westerns, List<Lot> Uva, List<Lot> Ne, List<Lot> Up) SplitHighGrownMarkGroups(List<Lot> highBandLots)
    {
        var ne = TopPriceEngine.FilterRowsByMarks(highBandLots, TopPriceEngine.NeMarks);
        var up = TopPriceEngine.FilterRowsByMarks(highBandLots, TopPriceEngine.UpMarks);
        var carved = new HashSet<Lot>(ne.Concat(up));
        var rest = highBandLots.Where(l => !carved.Contains(l)).ToList();
        return (rest.Where(IsWestern).ToList(), rest.Where(IsUva).ToList(), ne, up);
    }

    // ---- Medium Grown: flat 2-row per grade, Western Medium + Uva Medium pooled together ----

    private static BulletinSectionDto BuildMediumGrown(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.HighMediumGrown)
        {
            var tw = LotsForFamily(thisWeek, family.Grades).Where(IsMediumElevation).ToList();
            var lw = LotsForFamily(lastWeek, family.Grades).Where(IsMediumElevation).ToList();
            var rows = new List<BulletinRowDto>
            {
                BuildRow("Best Medium", tw, lw, TopTwoTiers),
                BuildRow("Other Medium", tw, lw, BottomTwoTiers),
            };
            tables.Add(new BulletinTableDto(family.Label, rows));
        }
        return new BulletinSectionDto("Medium Grown", tables);
    }

    // ---- Unorthodox (CTC): flat 2-row per grade, no elevation restriction ----

    private static BulletinSectionDto BuildUnorthodox(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.Unorthodox)
        {
            var tw = LotsForFamily(thisWeek, family.Grades);
            var lw = LotsForFamily(lastWeek, family.Grades);
            var rows = new List<BulletinRowDto>
            {
                BuildRow($"Best {family.Label}", tw, lw, TopTwoTiers),
                BuildRow($"Other {family.Label}", tw, lw, BottomTwoTiers),
            };
            tables.Add(new BulletinTableDto(family.Label, rows));
        }
        return new BulletinSectionDto("Unorthodox", tables);
    }

    // ---- H&M Orthodox Black Tea: flat 4-row per pooled grade family, High + Medium combined ----

    private static BulletinSectionDto BuildHmOrthodox(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.HmOrthodoxBlackTea)
        {
            var tw = LotsForFamily(thisWeek, family.Grades).Where(l => IsHighElevation(l) || IsMediumElevation(l)).ToList();
            var lw = LotsForFamily(lastWeek, family.Grades).Where(l => IsHighElevation(l) || IsMediumElevation(l)).ToList();
            var rows = new List<BulletinRowDto>
            {
                BuildRow("Select Best", tw, lw, [TierSplitter.SelectBest]),
                BuildRow("Best", tw, lw, [TierSplitter.Best]),
                BuildRow("Below Best", tw, lw, [TierSplitter.BelowBest]),
                BuildRow("Others", tw, lw, [TierSplitter.Poor]),
            };
            tables.Add(new BulletinTableDto(family.Label, rows));
        }
        return new BulletinSectionDto("H&M Orthodox Black Tea", tables);
    }

    // ---- Off Grades: Better/Other as separate tables, each with High/Medium/Low rows ----

    private static BulletinSectionDto BuildOffGrades(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.OffGrades)
            AddBandedBetterOtherTables(tables, thisWeek, lastWeek, family.Label, family.Grades);
        return new BulletinSectionDto("Off Grades", tables);
    }

    // ---- Dust: Primary (Orthodox) & Primary (CTC), each Better/Other x High/Medium/Low ----
    // (no real "Secondary" dust grade code exists in the data — see MarketBulletinGrades).

    private static BulletinSectionDto BuildDust(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        AddBandedBetterOtherTables(tables, thisWeek, lastWeek, "Primary (Orthodox)", MarketBulletinGrades.PrimaryOrthodoxDustGrades);
        AddBandedBetterOtherTables(tables, thisWeek, lastWeek, "Primary (CTC)", MarketBulletinGrades.PrimaryCtcDustGrades);
        return new BulletinSectionDto("Dust", tables);
    }

    /// <summary>Shared by Off Grades and Dust: for one grade family, adds a "Better {label}"
    /// table and an "Other {label}" table, each with High/Medium/Low rows.</summary>
    private static void AddBandedBetterOtherTables(
        List<BulletinTableDto> tables, List<Lot> thisWeek, List<Lot> lastWeek, string label, string[] grades)
    {
        var twAll = LotsForFamily(thisWeek, grades);
        var lwAll = LotsForFamily(lastWeek, grades);

        List<BulletinRowDto> BandRows(int[] tiers) =>
        [
            BuildRow("High", twAll.Where(IsHighElevation).ToList(), lwAll.Where(IsHighElevation).ToList(), tiers),
            BuildRow("Medium", twAll.Where(IsMediumElevation).ToList(), lwAll.Where(IsMediumElevation).ToList(), tiers),
            BuildRow("Low", twAll.Where(IsLowElevation).ToList(), lwAll.Where(IsLowElevation).ToList(), tiers),
        ];

        tables.Add(new BulletinTableDto($"Better {label}", BandRows(TopTwoTiers)));
        tables.Add(new BulletinTableDto($"Other {label}", BandRows(BottomTwoTiers)));
    }

    // ---- Low Grown: flat 4-row per grade, Elevation "L" only ----

    private static BulletinSectionDto BuildLowGrown(List<Lot> thisWeek, List<Lot> lastWeek)
    {
        var tables = new List<BulletinTableDto>();
        foreach (var family in MarketBulletinGrades.LowGrown)
        {
            var tw = LotsForFamily(thisWeek, family.Grades).Where(IsLowElevation).ToList();
            var lw = LotsForFamily(lastWeek, family.Grades).Where(IsLowElevation).ToList();
            var rows = new List<BulletinRowDto>
            {
                BuildRow("Select Best", tw, lw, [TierSplitter.SelectBest]),
                BuildRow("Best", tw, lw, [TierSplitter.Best]),
                BuildRow("Below Best", tw, lw, [TierSplitter.BelowBest]),
                BuildRow("Poor", tw, lw, [TierSplitter.Poor]),
            };
            tables.Add(new BulletinTableDto(family.Label, rows));
        }
        return new BulletinSectionDto("Low Grown", tables);
    }
}
