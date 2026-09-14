using Asc.Api.Modules.MarkIntelligence;

namespace Asc.Api.Tests;

public class FactoryMarkPerformanceServiceTests
{
    private static FactoryMarkPerformanceFact MarkDoc(int saleYear, int saleNo, params (string Grade, string Category, decimal Weight, decimal AvgPrice)[] grades) =>
        new()
        {
            Scope = FactoryMarkPerformanceScope.Mark,
            FactoryCode = "MF029405",
            MarkCode = "ROBGILL",
            SaleYear = saleYear,
            SaleNo = saleNo,
            GradeMix = [.. grades.Select(g => new GradeMixEntry { Grade = g.Grade, Category = g.Category, WeightKg = g.Weight, AvgPriceRs = g.AvgPrice })],
        };

    [Fact]
    public void Summarize_CombinesMultipleSales_WithWeightedAverage_NotAverageOfAverages()
    {
        // Sale 35: BOP 100kg @ Rs500. Sale 36: BOP 300kg @ Rs600.
        // Naive average of the two per-sale prices would be (500+600)/2 = 550 — wrong.
        // Weighted: (100*500 + 300*600) / 400 = 575.
        var docs = new[]
        {
            MarkDoc(2026, 35, ("BOP", "Main", 100m, 500m)),
            MarkDoc(2026, 36, ("BOP", "Main", 300m, 600m)),
        };

        var summary = FactoryMarkPerformanceService.Summarize("Mark", "MF029405", "ROBGILL", 2026, 35, 2026, 36, docs);

        Assert.Equal(2, summary.SalesIncluded);
        Assert.Equal(400m, summary.TotalWeightKg);
        Assert.Equal(230000m, summary.TotalProceedsRs);
        Assert.Equal(575m, summary.AvgPriceRs);
        var bop = Assert.Single(summary.GradeMix);
        Assert.Equal(575m, bop.AvgPriceRs);
        Assert.Equal(100m, bop.PctOfTotal);
    }

    [Fact]
    public void Summarize_BestGrades_ExcludesDustAcrossTheCombinedRange()
    {
        var docs = new[]
        {
            MarkDoc(2026, 35, ("BOP", "Main", 100m, 500m), ("DUST1", "Dust", 50m, 900m)),
            MarkDoc(2026, 36, ("BOP", "Main", 300m, 600m)),
        };

        var summary = FactoryMarkPerformanceService.Summarize("Mark", "MF029405", "ROBGILL", 2026, 35, 2026, 36, docs);

        Assert.Equal(["BOP"], summary.BestGrades);
    }

    [Fact]
    public void Summarize_NoDocsInRange_ReturnsZeroedSummary()
    {
        var summary = FactoryMarkPerformanceService.Summarize("Factory", "MF029405", null, 2026, 1, 2026, 50, []);

        Assert.Equal(0, summary.SalesIncluded);
        Assert.Equal(0m, summary.TotalWeightKg);
        Assert.Equal(0m, summary.AvgPriceRs);
        Assert.Empty(summary.GradeMix);
        Assert.Empty(summary.BestGrades);
    }

    [Fact]
    public void BuildGradeBreakdown_PrefersOwnTrailingStats_OverFactoryWideFallback()
    {
        var future = new Dictionary<string, decimal> { ["BOP"] = 100m };
        var own = new Dictionary<string, (decimal, decimal)> { ["BOP"] = (200m, 200m * 500m) }; // avg 500
        var factory = new Dictionary<string, (decimal, decimal)> { ["BOP"] = (200m, 200m * 900m) }; // avg 900 — must be ignored

        var breakdown = FactoryMarkPerformanceService.BuildGradeBreakdown(future, own, factory);

        var bop = Assert.Single(breakdown);
        Assert.Equal(500m, bop.TrailingAvgPriceRs);
        Assert.False(bop.UsedFactoryWideFallback);
        Assert.True(bop.HasTrailingPriceData);
        Assert.Equal(50000m, bop.EstimatedValueRs);
    }

    [Fact]
    public void BuildGradeBreakdown_FallsBackToFactoryWide_WhenOwnHistoryIsMissingForThatGrade()
    {
        var future = new Dictionary<string, decimal> { ["PEK"] = 50m };
        var own = new Dictionary<string, (decimal, decimal)>(); // mark has never traded PEK
        var factory = new Dictionary<string, (decimal, decimal)> { ["PEK"] = (100m, 100m * 300m) }; // avg 300

        var breakdown = FactoryMarkPerformanceService.BuildGradeBreakdown(future, own, factory);

        var pek = Assert.Single(breakdown);
        Assert.Equal(300m, pek.TrailingAvgPriceRs);
        Assert.True(pek.UsedFactoryWideFallback);
        Assert.True(pek.HasTrailingPriceData);
        Assert.Equal(15000m, pek.EstimatedValueRs);
    }

    [Fact]
    public void BuildGradeBreakdown_FlagsInsufficientData_WhenNeitherSourceHasThisGrade()
    {
        var future = new Dictionary<string, decimal> { ["OP"] = 30m };
        var own = new Dictionary<string, (decimal, decimal)>();
        var factory = new Dictionary<string, (decimal, decimal)>();

        var breakdown = FactoryMarkPerformanceService.BuildGradeBreakdown(future, own, factory);

        var op = Assert.Single(breakdown);
        Assert.Equal(0m, op.TrailingAvgPriceRs);
        Assert.False(op.UsedFactoryWideFallback);
        Assert.False(op.HasTrailingPriceData);
        Assert.Equal(0m, op.EstimatedValueRs);
    }
}
