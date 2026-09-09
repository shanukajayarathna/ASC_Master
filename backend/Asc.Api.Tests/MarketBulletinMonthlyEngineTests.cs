using Asc.Api.Models;
using Asc.Api.Modules.MarketBulletin;
using Asc.Api.Services;

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

    /// <summary>Supports configurable SalesInMonth (the real FakeCatalogueSource in
    /// MarketBulletinControllerTests hardcodes it to empty) — needed to drive
    /// MarketBulletinMonthlyEngine.Build end to end for the "future sale in this month" test.</summary>
    private sealed class FakeMonthlySource(
        Dictionary<Guid, Catalogue> catalogues,
        Dictionary<Guid, List<Lot>> lots,
        Dictionary<(int Year, int Month), List<(int SaleNo, DateTime Date)>> calendar) : ICatalogueSource
    {
        public IReadOnlyList<Catalogue> ListCatalogues() => [.. catalogues.Values];
        public Catalogue? GetCatalogue(Guid id) => catalogues.GetValueOrDefault(id);
        public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => lots.GetValueOrDefault(catalogueId);
        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => null;
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => [];
        public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => calendar.GetValueOrDefault((year, month), []);
        public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() => new Dictionary<string, (string Name, string Elevation)>();
    }

    private static Catalogue Sale(int year, int saleNo) => new()
    {
        Id = SaleFileStore.CatalogueIdFor(year, saleNo),
        Year = year,
        SourceName = $"Sale {saleNo} - {year}",
        ImportedAt = DateTime.UtcNow,
    };

    [Fact]
    public void Build_ViewingAnEarlySaleInAFiveSaleMonth_StillShowsAllFiveAsPlaceholdersForTheRest()
    {
        // Real bug scenario: viewing Sale 31 (the 2nd of August's 5 sales) used to only show
        // ThisMonth = [Sale 30, Sale 31] because the calendar was pre-filtered to <= 31, hiding
        // weeks 3-5 entirely instead of showing them as empty placeholder circles. Sale 32 and
        // 33 are given REAL sold data here specifically to prove the fix suppresses it (not just
        // that it happens to be absent) — "as of Sale 31," they haven't happened yet regardless
        // of what's already in the data store. Sale 34 has no catalogue at all, proving the
        // ordinary "not yet catalogued" placeholder still works alongside the new cutoff one.
        var soldLots = new List<Lot> { Lot("ASC", 100, 10) };
        var catalogues = new Dictionary<Guid, Catalogue>();
        var lots = new Dictionary<Guid, List<Lot>>();
        foreach (var saleNo in new[] { 30, 31, 32, 33 })
        {
            var cat = Sale(2026, saleNo);
            catalogues[cat.Id] = cat;
            lots[cat.Id] = soldLots;
        }

        var calendar = new Dictionary<(int, int), List<(int SaleNo, DateTime Date)>>
        {
            [(2026, 8)] =
            [
                (30, new DateTime(2026, 8, 1)), (31, new DateTime(2026, 8, 8)), (32, new DateTime(2026, 8, 15)),
                (33, new DateTime(2026, 8, 22)), (34, new DateTime(2026, 8, 29)),
            ],
            [(2026, 7)] = [(26, new DateTime(2026, 7, 4)), (27, new DateTime(2026, 7, 11)), (28, new DateTime(2026, 7, 18)), (29, new DateTime(2026, 7, 25))],
        };
        var source = new FakeMonthlySource(catalogues, lots, calendar);

        var dto = MarketBulletinMonthlyEngine.Build(source, Sale(2026, 31));
        Assert.NotNull(dto);
        Assert.Equal(5, dto!.ThisMonth.Count);

        Assert.NotNull(dto.ThisMonth[0].Tiers); // Sale 30 — before the viewed sale, real data
        Assert.NotNull(dto.ThisMonth[1].Tiers); // Sale 31 — the viewed sale itself, real data

        // Sales 32/33 have real sold lots in the store but haven't happened "as of Sale 31" —
        // must show up (with their real name) but WITHOUT tier data.
        Assert.Equal("Sale 32 - 2026", dto.ThisMonth[2].SourceName);
        Assert.Null(dto.ThisMonth[2].Tiers);
        Assert.Equal("Sale 33 - 2026", dto.ThisMonth[3].SourceName);
        Assert.Null(dto.ThisMonth[3].Tiers);

        // Sale 34 was never catalogued at all — same placeholder shape, no source name either.
        Assert.Null(dto.ThisMonth[4].SourceName);
        Assert.Null(dto.ThisMonth[4].Tiers);
    }

    [Fact]
    public void BuildTierMetricsForSale_UsesLiteralMinMax_EvenWithASingleOutlierLot()
    {
        // 20 "normal" lots evenly spaced 500..1830, plus one freak outlier at 5850 — mirrors
        // real Sale 31-2026 data (9,224 lots, Rs 420-5,850). A 5th-95th percentile trim was
        // tried here specifically to stop that one outlier from setting the ruler, but the
        // user's own senior confirmed the literal range is what they want even when only a
        // single lot sits at the extreme — so the outlier alone now sets Select Best's
        // threshold (5850-0.20*(5850-500)=4780), and only that one lot clears it.
        var normalLots = Enumerable.Range(0, 20).Select(i => Lot("ASC", 500 + i * 70, 10)).ToList();
        var lots = normalLots.Append(Lot("ASC", 5850, 10)).ToList();

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(1, selectBest.LotCount);
        Assert.Equal(5850m, selectBest.AveragePrice);
    }

    [Fact]
    public void BuildTierMetricsForSale_SplitsByPriceWidth_NotLotCount()
    {
        // Market spans 0..1000 (min=0, max=1000, span=1000): thresholds land at
        // 1000-0.20*1000=800 (Select Best), 1000-0.55*1000=450 (Best), 1000-0.85*1000=150
        // (Below Best), and 0 (Poor, the market's own minimum). A lot-count split on these same
        // 6 lots would instead force exactly 1/2/2/1 lots into each tier regardless of price —
        // this test proves the boundary is a price value, not a count.
        var lots = new List<Lot>
        {
            Lot("Forbes", 1000, 10),
            Lot("Forbes", 900, 10), // both >=800 -> Select Best, even though that's 2 of 6 lots (33%), not 20%
            Lot("ASC", 850, 10),
            Lot("ASC", 100, 10), // 100 < 150 -> Poor, even though most of the market priced above it
            Lot("Forbes", 50, 10),
            Lot("Forbes", 0, 10),
        };

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(1, selectBest.LotCount); // only ASC's 850 lot
        Assert.Equal(850m, selectBest.AveragePrice);

        var poor = tiers.Single(t => t.Tier == "Poor");
        Assert.Equal(1, poor.LotCount); // only ASC's 100 lot
        Assert.Equal(100m, poor.AveragePrice);

        Assert.Equal(0, tiers.Single(t => t.Tier == "Best").LotCount);
        Assert.Equal(0, tiers.Single(t => t.Tier == "Below Best").LotCount);
    }

    [Fact]
    public void BuildTierMetricsForSale_LongTailOfCheapLots_PoorCanExceedFixedFifteenPercent()
    {
        // A week where MOST of the market genuinely priced low: 8 of 10 lots are cheap (near the
        // market minimum), only 2 are expensive. A lot-count split would still force exactly 15%
        // (here, effectively 1-2 lots) into Poor; a price-width split lets Poor capture however
        // much of the real spread is actually down there. Span = 1000-0=1000, so Poor's own
        // threshold is 0 (the minimum) and Below Best's is 150 — everything at or below 150
        // lands in Below Best or Poor, which here is most of ASC's cheap lots.
        var lots = new List<Lot>
        {
            Lot("Forbes", 1000, 10),
            Lot("Forbes", 950, 10),
            Lot("ASC", 100, 10),
            Lot("ASC", 90, 10),
            Lot("ASC", 80, 10),
            Lot("ASC", 70, 10),
            Lot("ASC", 60, 10),
            Lot("ASC", 50, 10),
            Lot("ASC", 40, 10),
            Lot("ASC", 0, 10),
        };

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        // All 8 of ASC's lots (100 down to 0) sit at or below 150 -> Below Best or Poor.
        var belowBestPlusPoor = tiers.Where(t => t.Tier is "Below Best" or "Poor").Sum(t => t.LotCount);
        Assert.Equal(8, belowBestPlusPoor);
        Assert.Equal(0, tiers.Single(t => t.Tier == "Select Best").LotCount);
        Assert.Equal(0, tiers.Single(t => t.Tier == "Best").LotCount);
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

    [Fact]
    public void BuildTierMetricsForSale_AllLotsSamePrice_LandInSelectBest()
    {
        // Zero-width span (min == max) collapses every threshold to that same price, so every
        // lot (price == max == every threshold) matches Select Best's own check first.
        var lots = new List<Lot> { Lot("ASC", 500, 10), Lot("Forbes", 500, 10) };
        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);
        Assert.Equal(1, tiers.Single(t => t.Tier == "Select Best").LotCount);
    }
}
