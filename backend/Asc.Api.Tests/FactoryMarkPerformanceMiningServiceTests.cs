using Asc.Api.Modules.MarkIntelligence;

namespace Asc.Api.Tests;

public class FactoryMarkPerformanceMiningServiceTests
{
    private static readonly FactoryMarkPerformanceSourceReconciliation Reconciliation = new()
    {
        SourceUsed = FactoryMarkPerformanceSource.DataSales,
        DataSalesFileAvailable = true,
    };

    private static FactoryMarkPerformanceFact BuildMarkFact(Dictionary<string, (decimal Weight, decimal Proceeds)> gradeTotals) =>
        FactoryMarkPerformanceMiningService.BuildFact(
            FactoryMarkPerformanceScope.Mark, Guid.NewGuid(), "MF029405", Guid.NewGuid(), "ROBGILL",
            2026, 36, gradeTotals, Reconciliation, DateTime.UtcNow);

    [Theory]
    [InlineData("BOP", "Main")]
    [InlineData("bop", "Main")] // normalization is case-insensitive
    [InlineData("FBOPFExSp", "PremiumFlowery")]
    [InlineData("PF1", "Ctc")] // only in CtcGrades
    [InlineData("BOP1A", "Off")] // only in OffGrades
    [InlineData("DUST1", "Dust")] // only in DustGrades
    [InlineData("SOME-UNKNOWN-GRADE", "Other")]
    public void ClassifyGradeCategory_MatchesExpectedBucket(string grade, string expectedCategory)
    {
        Assert.Equal(expectedCategory, FactoryMarkPerformanceMiningService.ClassifyGradeCategory(grade));
    }

    [Fact]
    public void BuildFact_AvgPriceIsWeightedByVolume_NotAnAverageOfPerGradeAverages()
    {
        // BOP: 100kg @ Rs500/kg = 50,000. PEK: 300kg @ Rs400/kg = 120,000.
        // Naive average of the two per-grade prices would be (500+400)/2 = 450 — wrong.
        // Weighted: 170,000 / 400 = 425.
        var gradeTotals = new Dictionary<string, (decimal, decimal)>
        {
            ["BOP"] = (100m, 100m * 500m),
            ["PEK"] = (300m, 300m * 400m),
        };

        var fact = BuildMarkFact(gradeTotals);

        Assert.Equal(400m, fact.TotalWeightKg);
        Assert.Equal(170000m, fact.TotalProceedsRs);
        Assert.Equal(425m, fact.AvgPriceRs);
    }

    [Fact]
    public void BuildFact_GradeMixEntries_HavePctOfTotalAndPerGradeWeightedAvg()
    {
        var gradeTotals = new Dictionary<string, (decimal, decimal)>
        {
            ["BOP"] = (100m, 100m * 500m),
            ["PEK"] = (300m, 300m * 400m),
        };

        var fact = BuildMarkFact(gradeTotals);

        var bop = Assert.Single(fact.GradeMix, g => g.Grade == "BOP");
        Assert.Equal(25m, bop.PctOfTotal);
        Assert.Equal(500m, bop.AvgPriceRs);
        Assert.Equal("Main", bop.Category);

        var pek = Assert.Single(fact.GradeMix, g => g.Grade == "PEK");
        Assert.Equal(75m, pek.PctOfTotal);
        Assert.Equal(400m, pek.AvgPriceRs);
    }

    [Fact]
    public void BuildFact_BestGrades_ExcludesDustEvenWhenItsPriceIsHigher()
    {
        // DUST1 has the higher per-grade price (900 vs 500) but must never win "best grade" —
        // mirrors TopPriceEngine.IsTopPriceGrade's own exclusion of Off/Dust/Ctc grades.
        var gradeTotals = new Dictionary<string, (decimal, decimal)>
        {
            ["BOP"] = (100m, 100m * 500m),
            ["DUST1"] = (50m, 50m * 900m),
        };

        var fact = BuildMarkFact(gradeTotals);

        Assert.Equal(["BOP"], fact.BestGrades);
    }

    [Fact]
    public void BuildFact_BestGrades_IncludesAllGradesTiedAtTheTopPrice()
    {
        var gradeTotals = new Dictionary<string, (decimal, decimal)>
        {
            ["BOP"] = (100m, 100m * 500m),
            ["PEK"] = (50m, 50m * 500m), // exact tie with BOP
            ["OP"] = (20m, 20m * 300m),
        };

        var fact = BuildMarkFact(gradeTotals);

        Assert.Equal(2, fact.BestGrades.Count);
        Assert.Contains("BOP", fact.BestGrades);
        Assert.Contains("PEK", fact.BestGrades);
    }

    [Fact]
    public void BuildFact_NoGradesEligibleForBest_ReturnsEmptyBestGrades()
    {
        // Every grade present is Ctc/Off/Dust — nothing eligible to call "best."
        var gradeTotals = new Dictionary<string, (decimal, decimal)>
        {
            ["DUST1"] = (50m, 50m * 900m),
            ["BOP1A"] = (20m, 20m * 300m),
        };

        var fact = BuildMarkFact(gradeTotals);

        Assert.Empty(fact.BestGrades);
    }

    [Fact]
    public void BuildFact_ZeroWeight_DoesNotThrowAndReportsZeroPrice()
    {
        var fact = BuildMarkFact(new Dictionary<string, (decimal, decimal)>());

        Assert.Equal(0m, fact.TotalWeightKg);
        Assert.Equal(0m, fact.AvgPriceRs);
        Assert.Empty(fact.GradeMix);
        Assert.Empty(fact.BestGrades);
    }
}
