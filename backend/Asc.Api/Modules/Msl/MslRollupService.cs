using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Builds the mslSaleStats materialized rollups. One in-memory pass per sale over its lots
/// (~11k docs) computes every dimension at once — far cheaper than running one aggregation
/// pipeline per dimension per sale, and incremental: after an import only the affected
/// sales are rebuilt.
/// </summary>
public class MslRollupService(MongoContext db, ILogger<MslRollupService> logger)
{
    // Fixed Rs/kg bucket edges. They intentionally span the whole 2013–present price era —
    // a filter view, not a statistical histogram.
    private static readonly (decimal From, decimal To, string Label)[] PriceBuckets =
    [
        (0.01m, 400m, "< 400"),
        (400m, 600m, "400–600"),
        (600m, 800m, "600–800"),
        (800m, 1000m, "800–1,000"),
        (1000m, 1200m, "1,000–1,200"),
        (1200m, 1500m, "1,200–1,500"),
        (1500m, 2000m, "1,500–2,000"),
        (2000m, 3000m, "2,000–3,000"),
        (3000m, decimal.MaxValue, "3,000+"),
    ];

    public async Task RebuildForSalesAsync(IReadOnlyCollection<(int Year, int SaleNo)> sales, CancellationToken ct = default)
    {
        foreach (var (year, saleNo) in sales.Distinct())
        {
            ct.ThrowIfCancellationRequested();
            await RebuildOneAsync(year, saleNo, ct);
        }
        if (sales.Count > 0)
            logger.LogInformation("MSL rollups rebuilt for {Count} sale(s)", sales.Count);
    }

    /// <summary>Full rebuild for any sale present in auctionLots but missing (or force: all).
    /// Used for the initial backfill; incremental rebuilds happen via RebuildForSalesAsync.</summary>
    public async Task<int> RebuildMissingAsync(bool force = false, CancellationToken ct = default)
    {
        var present = await db.AuctionLots.Aggregate()
            .Group(l => new { l.SaleYear, l.SaleNo }, g => new { g.Key.SaleYear, g.Key.SaleNo })
            .ToListAsync(ct);
        var totals = await db.MslSaleStats.Find(s => s.Dimension == "total")
            .Project(s => new { s.Year, s.SaleNo }).ToListAsync(ct);
        var done = force ? [] : totals.Select(t => (t.Year, t.SaleNo)).ToHashSet();

        int built = 0;
        foreach (var s in present.OrderBy(s => s.SaleYear).ThenBy(s => s.SaleNo))
        {
            ct.ThrowIfCancellationRequested();
            if (done.Contains((s.SaleYear, s.SaleNo))) continue;
            await RebuildOneAsync(s.SaleYear, s.SaleNo, ct);
            built++;
        }
        if (built > 0) logger.LogInformation("MSL rollup backfill: {Built} sale(s) built", built);
        return built;
    }

    private async Task RebuildOneAsync(int year, int saleNo, CancellationToken ct)
    {
        var lots = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo)
            .ToListAsync(ct);

        var stats = new Dictionary<(string Dim, string Key), MslSaleStat>();
        var saleDate = DateTime.MinValue;

        void Add(string dim, string key, string? label, AuctionLot l)
        {
            if (!stats.TryGetValue((dim, key), out var s))
            {
                s = new MslSaleStat { Year = year, SaleNo = saleNo, Dimension = dim, Key = key, Label = label };
                stats[(dim, key)] = s;
            }
            s.Lots++;
            s.TotalQtyKg += l.QuantityKg;
            if (l.Sold)
            {
                s.SoldLots++;
                s.SoldQtyKg += l.QuantityKg;
                s.ProceedsRs += l.QuantityKg * l.PriceRs;
                s.MinPriceRs = s.MinPriceRs is null ? l.PriceRs : Math.Min(s.MinPriceRs.Value, l.PriceRs);
                s.MaxPriceRs = s.MaxPriceRs is null ? l.PriceRs : Math.Max(s.MaxPriceRs.Value, l.PriceRs);
            }
        }

        foreach (var l in lots)
        {
            if (l.SaleDate > saleDate) saleDate = l.SaleDate;
            Add("total", "all", null, l);
            if (l.Broker is not null) Add("broker", l.Broker, MslBrokers.CodeToName.GetValueOrDefault(l.Broker), l);
            if (l.Grade.Length > 0) Add("grade", l.Grade, null, l);
            if (l.ElevationCode is not null)
                Add("elevation", l.ElevationCode, MslBrokers.ElevationNames.GetValueOrDefault(l.ElevationCode), l);
            if (l.BuyerCode is not null) Add("buyer", l.BuyerCode, l.BuyerName, l);
            if (l.SellingMark.Length > 0) Add("mark", l.SellingMark, l.EstateName, l);
            if (l.FactoryCode.Length > 0) Add("factory", l.FactoryCode, l.FactoryCode, l);
            Add("priceRange", PriceBucket(l), null, l);
        }

        foreach (var s in stats.Values) s.SaleDate = saleDate;

        await db.MslSaleStats.DeleteManyAsync(s => s.Year == year && s.SaleNo == saleNo, ct);
        if (stats.Count > 0)
            await db.MslSaleStats.InsertManyAsync(stats.Values, new InsertManyOptions { IsOrdered = false }, ct);
    }

    private static string PriceBucket(AuctionLot l)
    {
        if (!l.Sold) return "Unsold";
        foreach (var (from, to, label) in PriceBuckets)
            if (l.PriceRs >= from && l.PriceRs < to)
                return label;
        return "3,000+";
    }
}
