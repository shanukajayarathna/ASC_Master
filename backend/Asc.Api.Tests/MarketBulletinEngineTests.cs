using Asc.Api.Models;
using Asc.Api.Modules.MarketBulletin;

namespace Asc.Api.Tests;

public class MarketBulletinEngineTests
{
    private static Lot Lot(decimal price, string grade = "BOP", string elevation = "WH", string? sellingMark = null, string status = "Sold") => new()
    {
        Grade = grade,
        Elevation = elevation,
        SellingMark = sellingMark,
        PurchasedPrice = price,
        Status = status,
    };

    // ---- TierSplitter ------------------------------------------------------------------

    [Fact]
    public void ComputeFourTiers_SplitsTwentyLotsInto_5_6_6_3()
    {
        // 20 lots, prices 20..1 descending once sorted. 25% of 20 = 5, next 30% = 6, next 30% = 6, last 15% = 3.
        var lots = Enumerable.Range(1, 20).Select(i => Lot(i)).ToList();
        var tiers = TierSplitter.ComputeFourTiers(lots);

        Assert.Equal(5, tiers[TierSplitter.SelectBest].LotCount);
        Assert.Equal(6, tiers[TierSplitter.Best].LotCount);
        Assert.Equal(6, tiers[TierSplitter.BelowBest].LotCount);
        Assert.Equal(3, tiers[TierSplitter.Poor].LotCount);

        // Select Best is the highest-priced 5 lots: 20 down to 16.
        Assert.Equal(20m, tiers[TierSplitter.SelectBest].Max);
        Assert.Equal(16m, tiers[TierSplitter.SelectBest].Min);
        // Poor is the lowest-priced 3 lots: 3 down to 1.
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
        Assert.Equal(11, better.LotCount); // 5 + 6
        Assert.Equal(20m, better.Max);
        Assert.Equal(10m, better.Min); // Best tier's lowest price

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

    // ---- MarketBulletinEngine: High Grown Westerns/Uva/NE/UP composition ----------------

    [Fact]
    public void HighGrown_SplitsWesternsUvaNeUp_AndAppliesEachRowTemplate()
    {
        var thisWeek = new List<Lot>
        {
            // Westerns (WH, not NE/UP marks) — 4 lots, 3-row template: top 2 = Best, next 1 = Below Best, last 1 = Other.
            Lot(400, elevation: "WH", sellingMark: "SOMEWESTERN1"),
            Lot(300, elevation: "WH", sellingMark: "SOMEWESTERN2"),
            Lot(200, elevation: "WH", sellingMark: "SOMEWESTERN3"),
            Lot(100, elevation: "WH", sellingMark: "SOMEWESTERN4"),
            // Uva (UH) — 2 lots, 2-row template.
            Lot(150, elevation: "UH", sellingMark: "SOMEUVA1"),
            Lot(50, elevation: "UH", sellingMark: "SOMEUVA2"),
            // Nuwara Eliya mark — untiered single row.
            Lot(90, elevation: "UH", sellingMark: "KENMARE"),
            // Udapussellawa mark — 2-row template.
            Lot(80, elevation: "UH", sellingMark: "DELMAR"),
            Lot(60, elevation: "UH", sellingMark: "DELMAR"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var highGrown = dto.Sections.Single(s => s.Title == "High Grown");
        var bopTable = highGrown.Tables.Single(t => t.GradeLabel == "BOP");

        var westerns = bopTable.Rows.Single(r => r.Label == "Best Westerns");
        Assert.Equal(400m, westerns.ThisWeek.Max);

        var belowBestWesterns = bopTable.Rows.Single(r => r.Label == "Below Best Westerns");
        Assert.Equal(1, belowBestWesterns.ThisWeek.LotCount);

        var otherWesterns = bopTable.Rows.Single(r => r.Label == "Other Westerns");
        Assert.Equal(1, otherWesterns.ThisWeek.LotCount);
        Assert.Equal(100m, otherWesterns.ThisWeek.Max);

        var ne = bopTable.Rows.Single(r => r.Label == "Nuwara Eliya");
        Assert.Equal(1, ne.ThisWeek.LotCount);
        Assert.Equal(90m, ne.ThisWeek.Min);
        Assert.Equal(90m, ne.ThisWeek.Max);

        var upBetter = bopTable.Rows.Single(r => r.Label == "Brighter Udapussellawa");
        var upOther = bopTable.Rows.Single(r => r.Label == "Other Udapussellawa");
        Assert.Equal(2, upBetter.ThisWeek.LotCount + upOther.ThisWeek.LotCount);
    }

    [Fact]
    public void OffGrades_SplitsByElevationBand_BetterAndOtherAsSeparateTables()
    {
        var thisWeek = new List<Lot>
        {
            Lot(500, grade: "FGS1", elevation: "WH"),
            Lot(100, grade: "FGS1", elevation: "WH"),
            Lot(300, grade: "FGS1", elevation: "L"),
        };

        var dto = MarketBulletinEngine.Build(thisWeek, null, "This Sale", null);
        var offGrades = dto.Sections.Single(s => s.Title == "Off Grades");

        var better = offGrades.Tables.Single(t => t.GradeLabel == "Better FGS1/FGS");
        var other = offGrades.Tables.Single(t => t.GradeLabel == "Other FGS1/FGS");

        var betterHigh = better.Rows.Single(r => r.Label == "High");
        var otherHigh = other.Rows.Single(r => r.Label == "High");
        Assert.Equal(1, betterHigh.ThisWeek.LotCount); // 500 is Select Best+Best of the 2-lot WH group
        Assert.Equal(1, otherHigh.ThisWeek.LotCount); // 100 is Below Best+Poor

        var betterLow = better.Rows.Single(r => r.Label == "Low");
        Assert.Equal(1, betterLow.ThisWeek.LotCount);
        Assert.Equal(300m, betterLow.ThisWeek.Max);
    }

    [Fact]
    public void LastWeekComparison_PairsRowsBySection_TableAndLabel()
    {
        var thisWeek = new List<Lot> { Lot(200, grade: "BOP1", elevation: "WH"), Lot(100, grade: "BOP1", elevation: "WH") };
        var lastWeek = new List<Lot> { Lot(150, grade: "BOP1", elevation: "WH"), Lot(50, grade: "BOP1", elevation: "WH") };

        var dto = MarketBulletinEngine.Build(thisWeek, lastWeek, "This Sale", "Last Sale");
        Assert.Equal("Last Sale", dto.PreviousSourceName);

        var hm = dto.Sections.Single(s => s.Title == "H&M Orthodox Black Tea");
        var table = hm.Tables.Single(t => t.GradeLabel == "BOP1/OP1");
        var selectBest = table.Rows.Single(r => r.Label == "Select Best");

        Assert.Equal(200m, selectBest.ThisWeek.Max);
        Assert.Equal(150m, selectBest.LastWeek.Max);
    }
}
