using Asc.Api.Models;
using Asc.Api.Modules.CategoryAverageTrend;

namespace Asc.Api.Tests;

public class CategoryAverageTrendEngineTests
{
    private static Lot L(string category, string grade, decimal kg, decimal price, string status = "Sold", string elevation = "L", string broker = "ASC") => new()
    {
        Category = category, Grade = grade, NetWeight = kg, PurchasedPrice = price, Status = status, Elevation = elevation, Broker = broker,
    };

    private static TrendSaleLots Sale(int no, params Lot[] lots) => new(no, 2026, lots);

    private static TrendCategoryDto Cat(CategoryAverageTrendDto dto, string name) => dto.Categories.Single(c => c.Name == name);

    [Fact]
    public void Average_IsTotalProceedsOverTotalQuantity_NotAverageOfPrices()
    {
        // 100 kg @ 1000 and 300 kg @ 2000 -> (100000 + 600000) / 400 = 1750, not (1000+2000)/2.
        var dto = CategoryAverageTrendEngine.Build([Sale(1, L("Leafy", "OP", 100, 1000), L("Leafy", "OP", 300, 2000))], null);
        Assert.Equal(1750m, Cat(dto, "Leafy").Cells[0].Average);
        Assert.Equal(1750m, Cat(dto, "Leafy").Grades.Single().Cells[0].Average);
    }

    [Fact]
    public void FinalPrice_IsUsedOverPurchasedPrice_WhenTheFileHasIt()
    {
        // An outsold lot bought at 1000 in the first round but settled at 1200 (Final Price) — the
        // worksheet's total proceeds use 1200; a lot with no Final Price falls back to Purchased Price.
        var settled = L("Leafy", "OP", 100, 1000, "Outsold");
        settled.RawData["Final Price"] = "1,200";
        var plain = L("Leafy", "OP", 100, 2000);
        var dto = CategoryAverageTrendEngine.Build([Sale(1, settled, plain)], null);
        Assert.Equal(1600m, Cat(dto, "Leafy").Cells[0].Average);
    }

    [Fact]
    public void SoldAndOutsold_Count_UnsoldDoesNot()
    {
        var dto = CategoryAverageTrendEngine.Build([Sale(1,
            L("Leafy", "OP", 100, 1000, "Sold"),
            L("Leafy", "OP", 100, 2000, "Outsold"),
            L("Leafy", "OP", 500, 0, "Unsold"))], null);
        Assert.Equal(1500m, Cat(dto, "Leafy").Cells[0].Average);
    }

    [Fact]
    public void LowGrownCategories_OnlyCountLowElevation_ButOffGradeAndDustCountEveryElevation()
    {
        var dto = CategoryAverageTrendEngine.Build([Sale(1,
            L("Leafy", "OP", 100, 1000, elevation: "L"),
            L("Leafy", "OP", 100, 3000, elevation: "UH"),
            L("Off Grade", "BM", 100, 600, elevation: "L"),
            L("Off Grade", "BM", 100, 800, elevation: "UH"),
            L("Dust", "PD", 100, 900, elevation: "WM"))], null);
        Assert.Equal(1000m, Cat(dto, "Leafy").Cells[0].Average);
        Assert.Equal(700m, Cat(dto, "Off Grade").Cells[0].Average);
        Assert.Equal(900m, Cat(dto, "Dust").Cells[0].Average);
    }

    [Fact]
    public void Categories_OutsideTheFixedSet_AreIgnored()
    {
        var dto = CategoryAverageTrendEngine.Build([Sale(1, L("Ex-estate", "BOP", 100, 1000), L("High and Medium", "BOP", 100, 1000))], null);
        Assert.All(dto.Categories, c => Assert.Null(c.Cells[0].Average));
        Assert.False(dto.HasResults);
    }

    [Fact]
    public void Change_IsAgainstThePreviousSale_AndTheSixthSaleIsOnlyTheBase()
    {
        var sales = new[] { 31, 32, 33, 34, 35, 36 }.Select(n => Sale(n, L("Leafy", "OP", 100, 1000 + n))).ToList();
        var dto = CategoryAverageTrendEngine.Build(sales, null);

        Assert.Equal([32, 33, 34, 35, 36], dto.Sales.Select(s => s.SaleNo));
        Assert.Equal("Sale 31/2026", dto.BaseSale);
        Assert.Equal("Sale 36/2026", dto.SelectedSale);
        var cells = Cat(dto, "Leafy").Cells;
        Assert.Equal(1032m, cells[0].Average);
        Assert.Equal(1m, cells[0].Change); // sale 32 vs the hidden base, sale 31
        Assert.All(cells, c => Assert.Equal(1m, c.Change));
    }

    [Fact]
    public void Change_IsDropWhenPriceFalls_AndNullWithoutAnEarlierSale()
    {
        var dto = CategoryAverageTrendEngine.Build([Sale(1, L("Tippy", "BOP", 100, 1500)), Sale(2, L("Tippy", "BOP", 100, 1400))], null);
        var cells = Cat(dto, "Tippy").Cells;
        Assert.Null(cells[0].Change);
        Assert.Equal(-100m, cells[1].Change);
        Assert.Null(dto.BaseSale);
    }

    [Fact]
    public void Change_IsNull_WhenEitherSaleHadNoSoldLotsForThatRow()
    {
        var dto = CategoryAverageTrendEngine.Build([
            Sale(1, L("Tippy", "BOP", 100, 1500)),
            Sale(2, L("Tippy", "BOPF", 100, 1400)),
            Sale(3, L("Tippy", "BOP", 100, 1600))], null);
        var bop = Cat(dto, "Tippy").Grades.Single(g => g.Grade == "BOP").Cells;
        Assert.Equal(1500m, bop[0].Average);
        Assert.Null(bop[1].Average);
        Assert.Null(bop[2].Change);
    }

    [Fact]
    public void BrokerFilter_NarrowsEveryFigure_AndTheBrokerListComesFromTheSelectedSale()
    {
        var sales = new[] { Sale(1, L("Leafy", "OP", 100, 1000, broker: "ASC"), L("Leafy", "OP", 100, 2000, broker: "FW")) };
        var all = CategoryAverageTrendEngine.Build(sales, null);
        var asc = CategoryAverageTrendEngine.Build(sales, "asc");
        Assert.Equal(1500m, Cat(all, "Leafy").Cells[0].Average);
        Assert.Equal(1000m, Cat(asc, "Leafy").Cells[0].Average);
        Assert.Equal(["ASC", "FW"], all.AvailableBrokers);
    }

    [Fact]
    public void Grades_AreListedBiggestQuantityFirst()
    {
        var dto = CategoryAverageTrendEngine.Build([Sale(1, L("Leafy", "OP1", 50, 1000), L("Leafy", "OPA", 500, 1000), L("Leafy", "OP", 200, 1000))], null);
        Assert.Equal(["OPA", "OP", "OP1"], Cat(dto, "Leafy").Grades.Select(g => g.Grade));
    }
}
