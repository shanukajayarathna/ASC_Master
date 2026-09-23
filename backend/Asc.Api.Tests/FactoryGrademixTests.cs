using Asc.Api.Models;
using Asc.Api.Modules.FactoryGrademix;

namespace Asc.Api.Tests;

public class FactoryGrademixTests
{
    private static void Near(decimal expected, decimal actual, decimal tolerance) =>
        Assert.True(Math.Abs(expected - actual) <= tolerance, $"expected {expected} ± {tolerance}, got {actual}");

    // The company's own printed Pothotuwa (March 25) sheet, scaled so qty = its percentage:
    // national avg 1,269.13; PEK/PEK1 14.47% @ 1,559.39 -> 42.00; OP/OPA 5.90% @ 1,396.52 -> 7.52;
    // OP1/BOP1 21.12% @ 1,905.17 -> 134.34; small leafy 52.23% @ 1,532.51 -> 137.56;
    // off grade 6.25% @ 1,061.94 -> -12.94; total 308.47; FacAvg 1,577.60.
    private static GrademixTableDto CompanySheet() => FactoryGrademixEngine.Build(
    [
        new GradeInput("PEKOE", 14.47m, 1559.39m),
        new GradeInput("OP", 5.90m, 1396.52m),
        new GradeInput("OP1", 21.12m, 1905.17m),
        new GradeInput("BOPF", 52.23m, 1532.51m),
        new GradeInput("BM", 6.25m, 1061.94m),
    ], 1269.13m);

    [Fact]
    public void Build_ContributionValues_MatchTheCompanysPrintedSheet()
    {
        var t = CompanySheet();
        Near(42.00m, t.Leafy[0].ContriValue, 0.1m);
        Near(7.52m, t.Leafy[1].ContriValue, 0.1m);
        Near(134.34m, t.Leafy[2].ContriValue, 0.1m);
        Near(137.56m, t.SmallLeafy.ContriValue, 0.1m);
        Near(-12.94m, t.OffGrade.ContriValue, 0.1m);
        Near(308.47m, t.TotalContri, 0.2m);
    }

    [Fact]
    public void Build_ContributionsAlwaysAddUpToFactoryAvgMinusNationalAvg()
    {
        var t = CompanySheet();
        Near(t.FactoryAvgRs!.Value - t.NationalAvgRs, t.TotalContri, 0.0001m);
    }

    [Fact]
    public void Build_LeafyBucketsAndOffGradesFollowTheCompanyLists()
    {
        var t = FactoryGrademixEngine.Build(
        [
            new GradeInput("BOP1", 100m, 1800m), // leafy (OP1/BOP1)
            new GradeInput("BOP", 100m, 1500m),  // main, small leafy
            new GradeInput("FGS", 50m, 700m),    // off grade
        ], 1200m);

        Assert.Equal(100m, t.Leafy[2].Qty);
        Assert.Equal(100m, t.SmallLeafy.Qty);
        Assert.Equal(50m, t.OffGrade.Qty);
        Assert.Equal(["BOP", "BOP1"], t.Main.Select(r => r.Grade));
        Assert.Equal(["FGS"], t.Off.Select(r => r.Grade));
    }

    [Fact]
    public void Build_UnpricedGrade_IsListedButLeftOutOfSharesAndAverages()
    {
        var t = FactoryGrademixEngine.Build(
        [
            new GradeInput("BOP", 100m, 1000m),
            new GradeInput("PF1", 5000m, null),
        ], 1000m);

        Assert.Equal(5000m, t.UnpricedKg);
        Assert.Equal(1000m, t.FactoryAvgRs);
        Assert.Equal(100m, t.All.QtyPct);
        Assert.Null(t.Main.Single(r => r.Grade == "PF1").QtyPct);
    }

    [Fact]
    public void Aggregate_CountsSoldAndOutsold_ValuesAtPurchasedPrice_AndFlagsSettled()
    {
        var lots = new List<Lot>
        {
            new() { Factory = "MF01558", FactoryName = "ARUNA TEA FACTORY", Grade = "BOP", NetWeight = 500, Status = "Sold", PurchasedPrice = 1000, Elevation = "WH", SellingMark = "ARUNA" },
            new() { Factory = "MF1558A", Grade = "BOP", NetWeight = 300, Status = "Outsold", PurchasedPrice = 2000, Elevation = "WH", SellingMark = "ARUNA" },
            new() { Factory = "MF1558", Grade = "BOP", NetWeight = 200, Status = "Unsold", Elevation = "WH", SellingMark = "ARUNA" },
        };

        var agg = FactoryGrademixService.Aggregate(2026, 36, new DateTime(2026, 9, 16), lots);

        var f = Assert.Single(agg.Factories).Value; // MF01558 / MF1558A / MF1558 are one factory
        Assert.Equal("MF1558", f.Code);
        Assert.True(agg.Settled);
        var bop = f.Grades["BOP"];
        Assert.Equal(1000m, bop.OfferedKg);
        Assert.Equal(800m, bop.SoldKg);
        Assert.Equal(500m * 1000m + 300m * 2000m, bop.ValueRs);
    }

    [Fact]
    public void Aggregate_AllPendingSale_IsNotSettled()
    {
        var lots = new List<Lot>
        {
            new() { Factory = "MF1558", Grade = "BOP", NetWeight = 500, Status = "Pending", Elevation = "L" },
        };
        Assert.False(FactoryGrademixService.Aggregate(2026, 37, DateTime.UtcNow, lots).Settled);
    }
}
