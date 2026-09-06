using Asc.Api.Models;
using Asc.Api.Modules.MarketBulletin;

namespace Asc.Api.Tests;

public class MarketBulletinMonthlyEngineTests
{
    private static Lot Lot(string broker, decimal price, decimal netWeight, string status = "Sold") => new()
    {
        Broker = broker,
        PurchasedPrice = price,
        NetWeight = netWeight,
        Status = status,
    };

    [Fact]
    public void BuildTierMetricsForSale_ExcludesOtherBrokersLots()
    {
        // 4 ASC lots (prices 100, 90, 80, 70) plus 4 other-broker lots at higher prices, which
        // would otherwise dominate the top tiers and drag ASC's own real numbers off — confirmed
        // with the user this page must be Asia Siyaka's own book, not the whole multi-broker sale.
        var lots = new List<Lot>
        {
            Lot("ASC", 100, 10),
            Lot("ASC", 90, 10),
            Lot("ASC", 80, 10),
            Lot("ASC", 70, 10),
            Lot("Forbes", 500, 10),
            Lot("Forbes", 400, 10),
            Lot("Somerville", 300, 10),
            Lot("Somerville", 200, 10),
        };

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        Assert.Equal(4, tiers.Sum(t => t.LotCount));
        Assert.All(tiers, t => Assert.True(t.QuantityKg is null or <= 40));
        // The highest ASC price (100) must land in Select Best, not any of the other brokers'
        // higher prices — proof the split ran on the ASC-only subset, not the full lot list.
        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(100m, selectBest.AveragePrice);
    }

    [Fact]
    public void BuildTierMetricsForSale_BrokerMatchIsCaseAndPunctuationInsensitive()
    {
        var lots = new List<Lot> { Lot("a.s.c.", 100, 10), Lot("ASC", 90, 10), Lot("Forbes", 500, 10) };
        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);
        Assert.Equal(2, tiers.Sum(t => t.LotCount));
    }

    [Fact]
    public void BuildTierMetricsForSale_NoAscLots_ReturnsFourEmptyTiers()
    {
        var lots = new List<Lot> { Lot("Forbes", 500, 10), Lot("Somerville", 300, 10) };
        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);
        Assert.All(tiers, t => Assert.Equal(0, t.LotCount));
        Assert.All(tiers, t => Assert.Null(t.QuantityKg));
    }
}
