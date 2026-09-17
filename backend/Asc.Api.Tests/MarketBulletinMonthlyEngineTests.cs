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
        public IReadOnlyDictionary<string, DateTime> GetRecentlySharedFactoryCodeDates() => new Dictionary<string, DateTime>();
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
    public void BuildTierMetricsForSale_PoorThresholdIsLiteralMinimumPrice_EvenWithASingleOutlierLot()
    {
        // 20 "normal" lots evenly spaced 500..1830, plus one freak outlier at 5850 — mirrors
        // real Sale 31-2026 data (9,224 lots, Rs 420-5,850). Whatever the cumulative-quantity
        // cuts land on, Poor's own threshold is always simply the sale's lowest sold price (500
        // here), so ASC's own lowest lot always still matches it, however extreme the top of the
        // market gets.
        var normalLots = Enumerable.Range(0, 20).Select(i => Lot("ASC", 500 + i * 70, 10)).ToList();
        var lots = normalLots.Append(Lot("ASC", 5850, 10)).ToList();

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        // The single outlier is 1 of 21 equally-weighted lots (10kg each, 210kg total) — nowhere
        // near the 15% cumulative share (31.5kg) needed to set Select Best's own threshold alone,
        // unlike the old price-width cut where its raw price did. Cumulative quantity only
        // crosses 31.5kg at the 4th lot by price (5850, 1830, 1760, 1690 = 40kg), so Select Best
        // ends up with those top 4 lots, not just the one outlier.
        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(4, selectBest.LotCount);
    }

    [Fact]
    public void BuildTierMetricsForSale_CutsByCumulativeQuantity_NotLotCount()
    {
        // One heavy, cheap-ish lot (80 of 100 total kg) sits second-from-top by price, next to
        // four much lighter lots. A lot-count cut of these 5 lots would put exactly the single
        // top-priced lot (15% of 5) in Select Best; a cumulative-QUANTITY cut instead keeps
        // accumulating past that top lot's own small 1kg share until the running total crosses
        // 15%, which only happens once the 80kg lot is included too — proving the threshold
        // tracks traded weight, not how many lots are being counted.
        var lots = new List<Lot>
        {
            Lot("ASC", 1000, 1),
            Lot("ASC", 900, 80),
            Lot("ASC", 800, 5),
            Lot("ASC", 700, 5),
            Lot("ASC", 600, 9),
        };
        // Total kg = 100. Cumulative by price desc: 1000->1 (1%), 900->81 (81%, crosses both 15%
        // and 45% at once), 800->86 (86%, crosses 85%), 700->91%, 600->100%. So thresholds:
        // Select Best >= 900, Best >= 900 too (ties to the same lot — nothing separately clears
        // Best's own band), Below Best >= 800, Poor (catch-all) = 600 (the sale's own minimum).

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(2, selectBest.LotCount); // 1000 and 900 both clear the >=900 threshold
        Assert.Equal(81m, selectBest.QuantityKg); // 1 + 80

        Assert.Equal(0, tiers.Single(t => t.Tier == "Best").LotCount); // ties to Select Best's own threshold, nothing left to clear it separately

        var belowBest = tiers.Single(t => t.Tier == "Below Best");
        Assert.Equal(1, belowBest.LotCount); // 800 clears >=800 but not >=900
        Assert.Equal(5m, belowBest.QuantityKg);

        var poor = tiers.Single(t => t.Tier == "Poor");
        Assert.Equal(2, poor.LotCount); // 700 and 600 fall to the catch-all
        Assert.Equal(14m, poor.QuantityKg); // 5 + 9
    }

    [Fact]
    public void BuildTierMetricsForSale_HeavyCheapLots_PullThresholdsDownByWeightNotCount()
    {
        // Two expensive lots carry almost no weight (1kg each); eight cheaper lots carry most of
        // the market's real quantity (20kg each). A plain lot-count cut of these 10 lots would
        // put exactly the top 1-2 (15%) in Select Best regardless of weight — but here the two
        // priciest lots are only 2 of 162 total kg (~1.2%), so cumulative quantity doesn't clear
        // 15% until two of the "cheap-but-heavy" lots are included too, pulling Select Best's
        // threshold well down the price axis from where a count-based cut would set it.
        var lots = new List<Lot>
        {
            Lot("ASC", 1000, 1),
            Lot("ASC", 950, 1),
            Lot("ASC", 100, 20),
            Lot("ASC", 90, 20),
            Lot("ASC", 80, 20),
            Lot("ASC", 70, 20),
            Lot("ASC", 60, 20),
            Lot("ASC", 50, 20),
            Lot("ASC", 40, 20),
            Lot("ASC", 0, 20),
        };

        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);

        // A lot-count cut would only ever put the top 2 priced lots (1000, 950) in Select Best.
        // The quantity cut instead reaches all the way down to 90 before the running total
        // clears 15% of the market's 162kg (24.3kg needed; cumulative only gets there at
        // 1+1+20+20=42kg, 25.9%, the total after that 4th lot) — 4 lots, not 2.
        var selectBest = tiers.Single(t => t.Tier == "Select Best");
        Assert.Equal(4, selectBest.LotCount);
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
        // Every lot priced identically means every cumulative-quantity threshold lands on that
        // same price too, so every lot (price == every threshold) matches Select Best's own
        // check first.
        var lots = new List<Lot> { Lot("ASC", 500, 10), Lot("Forbes", 500, 10) };
        var tiers = MarketBulletinMonthlyEngine.BuildTierMetricsForSale(lots);
        Assert.Equal(1, tiers.Single(t => t.Tier == "Select Best").LotCount);
    }
}
