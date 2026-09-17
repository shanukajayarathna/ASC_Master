using Asc.Api.Models;
using Asc.Api.Modules.MarketBulletin;

namespace Asc.Api.Tests;

public class MarketBulletinEngineTests
{
    private static Lot Lot(decimal price, string grade = "BOP", string elevation = "WH", string? sellingMark = null, string status = "Sold", string? category = null) => new()
    {
        Grade = grade,
        Elevation = elevation,
        SellingMark = sellingMark,
        PurchasedPrice = price,
        Status = status,
        Category = category,
    };

    // ---- TierSplitter ------------------------------------------------------------------

    [Fact]
    public void ComputeFourTiers_SplitsTwentyLotsInto_3_6_8_3()
    {
        // 20 lots, prices 20..1 descending once sorted. 15% of 20 = 3, next 30% = 6, next 40% = 8, last 15% = 3.
        var lots = Enumerable.Range(1, 20).Select(i => Lot(i)).ToList();
        var tiers = TierSplitter.ComputeFourTiers(lots);

        Assert.Equal(3, tiers[TierSplitter.SelectBest].LotCount);
        Assert.Equal(6, tiers[TierSplitter.Best].LotCount);
        Assert.Equal(8, tiers[TierSplitter.BelowBest].LotCount);
        Assert.Equal(3, tiers[TierSplitter.Poor].LotCount);

        // Select Best is the highest-priced 3 lots: 20 down to 18.
        Assert.Equal(20m, tiers[TierSplitter.SelectBest].Max);
        Assert.Equal(18m, tiers[TierSplitter.SelectBest].Min);
        // Poor is the lowest-priced 3 lots: 3 down to 1 — unchanged from the old split, since the
        // bottom 15% is the one proportion that didn't move (only Select Best 20->15% and Best
        // 35->30% changed; Below Best absorbed the difference, growing 30->40%).
        Assert.Equal(3m, tiers[TierSplitter.Poor].Max);
        Assert.Equal(1m, tiers[TierSplitter.Poor].Min);
    }

    [Fact]
    public void ComputeFourTiers_EmptyGroup_ReturnsFourEmptyTiers()
    {
        var tiers = TierSplitter.ComputeFourTiers([]);
        Assert.All(tiers, t => Assert.Equal(0, t.LotCount));
        Assert.All(tiers, t => Assert.Null(t.Min));
    }

    [Fact]
    public void ComputeFourTiers_IgnoresLotsWithNoPurchasedPrice()
    {
        var lots = new List<Lot> { Lot(100), Lot(50), new() { Grade = "BOP", PurchasedPrice = null } };
        var tiers = TierSplitter.ComputeFourTiers(lots);
        Assert.Equal(2, tiers.Sum(t => t.LotCount));
    }

    [Fact]
    public void Merge_CombinesSelectedTiers_MinOfMinsMaxOfMaxes()
    {
        var lots = Enumerable.Range(1, 20).Select(i => Lot(i)).ToList();
        var tiers = TierSplitter.ComputeFourTiers(lots);

        var better = TierSplitter.Merge(tiers, TierSplitter.SelectBest, TierSplitter.Best);
        Assert.Equal(9, better.LotCount); // 3 + 6
        Assert.Equal(20m, better.Max);
        Assert.Equal(12m, better.Min); // Best tier's lowest price

        var full = TierSplitter.Merge(tiers, TierSplitter.SelectBest, TierSplitter.Best, TierSplitter.BelowBest, TierSplitter.Poor);
        Assert.Equal(20, full.LotCount);
        Assert.Equal(1m, full.Min);
        Assert.Equal(20m, full.Max);
    }

    [Fact]
    public void Merge_WhenAllSelectedTiersEmpty_ReturnsEmpty()
    {
        var tiers = TierSplitter.ComputeFourTiers([]);
        var merged = TierSplitter.Merge(tiers, TierSplitter.SelectBest, TierSplitter.Best);
        Assert.Equal(0, merged.LotCount);
        Assert.Null(merged.Min);
    }

    // ---- MarketBulletinEngine: new category-based section structure ---------------------

    [Fact]
    public void LowGrown_IsOneSection_WithLeafySemiLeafyTippyAsGroupLabels()
    {
        // 5 OP1 lots rather than 1 — at the 15% Select Best cut, a 1-lot group rounds DOWN to
        // an empty Select Best tier (round(1*0.15)=0); 5 lots keeps it non-empty (round(5*0.15)=1).
        var thisWeek = new List<Lot>
        {
            Lot(500, grade: "OP1", elevation: "L"),
            Lot(400, grade: "OP1", elevation: "L"),
            Lot(300, grade: "OP1", elevation: "L"),
            Lot(200, grade: "OP1", elevation: "L"),
            Lot(100, grade: "OP1", elevation: "L"),
            Lot(90, grade: "OP", elevation: "L"),
            Lot(80, grade: "OPA", elevation: "L"),
            Lot(70, grade: "BOP1", elevation: "L"),
            // Same grade at a non-Low elevation must NOT leak into Low Grown.
            Lot(999, grade: "OP1", elevation: "WH"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);

        // ONE section, not three — "Low Grown — Leafy" as a separate top-level section was the
        // first attempt; the user wants a single "Low Grown" section with Leafy/Semi Leafy/Tippy
        // as sub-group labels on the tables themselves instead.
        var lowGrown = dto.Sections.Single(s => s.Title == "Low Grown");
        Assert.DoesNotContain(dto.Sections, s => s.Title.Contains("Leafy", StringComparison.Ordinal));

        var op1Table = lowGrown.Tables.Single(t => t.GradeLabel == "OP1");
        Assert.Equal("Leafy", op1Table.GroupLabel);
        var bop1Table = lowGrown.Tables.Single(t => t.GradeLabel == "BOP1");
        Assert.Equal("Semi Leafy", bop1Table.GroupLabel);

        // Order matches the user's stated order (OP1, OP, OPA first), not alphabetical.
        Assert.Equal("OP1", lowGrown.Tables[0].GradeLabel);
        Assert.Equal("OP", lowGrown.Tables[1].GradeLabel);
        Assert.Equal("OPA", lowGrown.Tables[2].GradeLabel);

        var selectBest = op1Table.Rows.Single(r => r.Label == "Select Best");
        Assert.Equal(1, selectBest.ThisWeek.LotCount);
        Assert.Equal(500m, selectBest.ThisWeek.Max); // the WH lot (999) must not appear here
    }

    [Fact]
    public void HighAndMedium_FlatFourRowPerGrade_NoMarkOrWesternsUvaSplit_IncludesHighAndMediumExcludesLow()
    {
        // 5 lots rather than 1 — see LowGrown test's own comment on why (a 1-lot group rounds
        // its Select Best tier to empty at the 15% cut). Mixed WH/UH/WM/UM elevations and a
        // Nuwara Eliya selling mark are deliberately thrown in together — none of that should
        // matter anymore, only whether the elevation is High or Medium at all.
        var thisWeek = new List<Lot>
        {
            Lot(500, grade: "OP1", elevation: "WH"),
            Lot(400, grade: "OP1", elevation: "UH", sellingMark: "KENMARE"), // Nuwara Eliya mark — no longer its own row
            Lot(300, grade: "OP1", elevation: "WM"),
            Lot(200, grade: "OP1", elevation: "UM"),
            Lot(100, grade: "OP1", elevation: "WH"),
            // Low elevation must NOT leak into High and Medium.
            Lot(999, grade: "OP1", elevation: "L"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var highAndMedium = dto.Sections.Single(s => s.Title == "High and Medium");
        var op1Table = highAndMedium.Tables.Single(t => t.GradeLabel == "OP1");

        // Flat list, no Leafy/Semi Leafy/Tippy sub-headers here — unlike Low Grown.
        Assert.Null(op1Table.GroupLabel);

        // Only the classic 4 rows — no Westerns/Uva/Nuwara Eliya/Udapussellawa/Medium split.
        Assert.Equal(["Select Best", "Best", "Below Best", "Poor"], op1Table.Rows.Select(r => r.Label));

        var selectBest = op1Table.Rows.Single(r => r.Label == "Select Best");
        Assert.Equal(1, selectBest.ThisWeek.LotCount);
        Assert.Equal(500m, selectBest.ThisWeek.Max); // the L lot (999) must not appear here

        Assert.Equal(5, op1Table.Rows.Sum(r => r.ThisWeek.LotCount)); // all 5 High/Medium lots accounted for
    }

    [Fact]
    public void OffGrade_FlatFourRowPerGrade_NoElevationRestriction_IncludesBop1A()
    {
        var thisWeek = new List<Lot>
        {
            Lot(500, grade: "FGS1", elevation: "WH"),
            Lot(100, grade: "FGS1", elevation: "L"),
            Lot(200, grade: "BOP1A", elevation: "WH"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var offGrade = dto.Sections.Single(s => s.Title == "Off Grade");

        var fgs1Table = offGrade.Tables.Single(t => t.GradeLabel == "FGS1");
        Assert.Equal(2, fgs1Table.Rows.Sum(r => r.ThisWeek.LotCount)); // both elevations pooled, flat 4-row

        // BOP1A is its own raw Category in real data but the user wants it folded in here.
        Assert.Contains(offGrade.Tables, t => t.GradeLabel == "BOP1A");
    }

    [Fact]
    public void Dust_TwelveRowsPerGrade_LowMediumHighElevationBands()
    {
        // 5 lots per elevation band rather than 1 — see LowGrown test's own comment on why
        // (a 1-lot group rounds its Select Best tier to empty at the 15% cut).
        static List<Lot> Band(string elevation, decimal top) =>
            Enumerable.Range(0, 5).Select(i => Lot(top - i * 5, grade: "PD", elevation: elevation)).ToList();

        var thisWeek = new List<Lot>();
        thisWeek.AddRange(Band("L", 100));
        thisWeek.AddRange(Band("WM", 200));
        thisWeek.AddRange(Band("WH", 300));

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var dust = dto.Sections.Single(s => s.Title == "Dust");
        var pdTable = dust.Tables.Single(t => t.GradeLabel == "PD");

        Assert.Equal(12, pdTable.Rows.Count);
        Assert.Equal(["Low", "Medium", "High"], pdTable.Rows.Select(r => r.Label.Split(' ')[0]).Distinct());

        var lowSelectBest = pdTable.Rows.Single(r => r.Label == "Low Select Best");
        Assert.Equal(100m, lowSelectBest.ThisWeek.Max);
        var highSelectBest = pdTable.Rows.Single(r => r.Label == "High Select Best");
        Assert.Equal(300m, highSelectBest.ThisWeek.Max);
    }

    [Fact]
    public void Unorthodox_UsesExpandedFourGradeList()
    {
        var thisWeek = new List<Lot>
        {
            Lot(100, grade: "BP1", elevation: "L"),
            Lot(100, grade: "BPS", elevation: "L"),
            Lot(100, grade: "OF", elevation: "L"),
            Lot(100, grade: "PF1", elevation: "L"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var unorthodox = dto.Sections.Single(s => s.Title == "Unorthodox");

        Assert.Equal(["BP1", "BPS", "OF", "PF1"], unorthodox.Tables.Select(t => t.GradeLabel));
    }

    [Fact]
    public void ExEstate_GroupsByRawCategory_Alphabetical_ExcludesUnorthodoxGrades()
    {
        var thisWeek = new List<Lot>
        {
            Lot(100, grade: "PEK", elevation: "WH", category: "Ex-estate"),
            Lot(200, grade: "BOP", elevation: "WH", category: "Ex-estate"),
            // BP1 is tagged Ex-estate in real data too, but must be excluded here (it's Unorthodox's).
            Lot(300, grade: "BP1", elevation: "WH", category: "Ex-estate"),
            // A different category must not leak in.
            Lot(400, grade: "FBOP", elevation: "WH", category: "High and Medium"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var exEstate = dto.Sections.Single(s => s.Title == "Ex-estate");

        // Alphabetical, and BP1/FBOP excluded (BP1 -> Unorthodox's, FBOP -> not Ex-estate category).
        Assert.Equal(["BOP", "PEK"], exEstate.Tables.Select(t => t.GradeLabel));
    }

    [Fact]
    public void LastWeekComparison_PairsRowsBySection_TableAndLabel()
    {
        // 5 lots a side rather than 2 — at the 15% Select Best cut, a 2-lot group rounds DOWN to
        // an empty Select Best tier (round(2*0.15)=0), which isn't what this test is about; 5
        // lots keeps Select Best non-empty (round(5*0.15)=1) so the assertions below actually
        // exercise the this-week/last-week pairing this test targets, not a rounding edge case.
        var thisWeek = new List<Lot>
        {
            Lot(200, grade: "FGS1", elevation: "WH"),
            Lot(160, grade: "FGS1", elevation: "WH"),
            Lot(140, grade: "FGS1", elevation: "WH"),
            Lot(120, grade: "FGS1", elevation: "WH"),
            Lot(100, grade: "FGS1", elevation: "WH"),
        };
        var lastWeek = new List<Lot>
        {
            Lot(150, grade: "FGS1", elevation: "WH"),
            Lot(110, grade: "FGS1", elevation: "WH"),
            Lot(90, grade: "FGS1", elevation: "WH"),
            Lot(70, grade: "FGS1", elevation: "WH"),
            Lot(50, grade: "FGS1", elevation: "WH"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, lastWeek, "This Sale", "Last Sale");
        Assert.Equal("Last Sale", dto.PreviousSourceName);

        var offGrade = dto.Sections.Single(s => s.Title == "Off Grade");
        var table = offGrade.Tables.Single(t => t.GradeLabel == "FGS1");
        var selectBest = table.Rows.Single(r => r.Label == "Select Best");

        Assert.Equal(200m, selectBest.ThisWeek.Max);
        Assert.Equal(150m, selectBest.LastWeek.Max);
    }
}
