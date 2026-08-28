using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;

namespace Asc.Api.Modules.CategoryReports;

/// <summary>
/// Computes the Ex-Estate-style category analysis — broker distribution, sold/outsold/unsold,
/// Select Best/Best/Below Best/Poor price tiers, and the flagship "Price & Classification —
/// Sale x Broker" table — from real catalogue Lot data (Category/Broker/Status/PurchasedPrice/
/// SellingMark/NetWeight/SaleNo/SaleYear), the same fields TopPriceEngine ranks on. Reuses
/// TopPriceEngine.IsSold/IsOutsold for status normalization rather than a raw string match, so
/// this agrees with every other report in the app about what "sold" means regardless of how a
/// given broker's file spells its Status column ("Sold"/"S"/"SLD"...).
///
/// Tiers are quartiles of achieved price among a SALE'S OWN sold lots, recomputed sale by sale
/// and only pooled afterwards for the summary table — the same reasoning a taster's cutoffs
/// follow week to week, and why "unsold" lots are never assigned a tier: they carry no achieved
/// price to rank by, and asserting one anyway  was a real accuracy bug caught in an earlier,
/// hand-built version of this report (see the Sale x Broker sheet's own doc comment).
/// </summary>
public static class CategoryAnalysisEngine
{
    private static readonly string[] TierNames = ["Select Best", "Best", "Below Best", "Poor"];

    private static string NormalizeKey(string? value) =>
        new([.. (value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    /// <summary>Positive match, mirroring TopPriceEngine.IsSold/IsOutsold — NOT "has a Status
    /// but isn't Sold or Outsold", because real catalogue files carry a fourth value, "Pending"
    /// (a sale that hasn't happened yet), which an exclusion-based check would wrongly count as
    /// Unsold. Caught by testing against a live sale range that included upcoming sales.</summary>
    public static bool IsUnsold(Lot lot)
    {
        var s = NormalizeKey(lot.Status);
        return s is "u" or "unsld" || s.StartsWith("unsold");
    }

    public static List<CategoryOptionDto> CategoryOptions(IEnumerable<Lot> lots) =>
        [.. lots
            .Where(l => !string.IsNullOrWhiteSpace(l.Category))
            .GroupBy(l => NormalizeKey(l.Category))
            .Select(g => new CategoryOptionDto(g.First().Category!.Trim(), g.Count()))
            .OrderByDescending(o => o.LotCount)];

    private static int ParseIntOr(string? s, int fallback) => int.TryParse(s, out var v) ? v : fallback;

    private sealed record LotSale(Lot Lot, int SaleNo, int SaleYear);

    public static CategoryAnalysisDto Build(IEnumerable<Lot> allLots, string category)
    {
        var normCategory = NormalizeKey(category);
        var scoped = allLots
            .Where(l => NormalizeKey(l.Category) == normCategory)
            .Select(l => new LotSale(l, ParseIntOr(l.SaleNo, 0), ParseIntOr(l.SaleYear, 0)))
            .ToList();

        var sales = scoped.Select(x => (x.SaleNo, x.SaleYear)).Distinct()
            .OrderBy(x => x.SaleYear).ThenBy(x => x.SaleNo)
            .Select(x => new SaleRefDto(x.SaleNo, x.SaleYear, $"Sale {x.SaleNo}/{x.SaleYear}"))
            .ToList();

        // ---- tier assignment: quartile of achieved price, computed within each sale on its own ----
        var tierOf = new Dictionary<Lot, string>();
        foreach (var saleGroup in scoped.GroupBy(x => (x.SaleNo, x.SaleYear)))
        {
            var sold = saleGroup
                .Where(x => TopPriceEngine.IsSold(x.Lot) && (x.Lot.PurchasedPrice ?? 0) > 0)
                .OrderByDescending(x => x.Lot.PurchasedPrice!.Value)
                .ToList();
            var n = sold.Count;
            if (n == 0) continue;
            var q = n / 4.0;
            for (var i = 0; i < n; i++)
                tierOf[sold[i].Lot] = TierNames[Math.Min((int)(i / q), 3)];
        }

        var totalLots = scoped.Count;

        // ---- broker distribution ----
        var brokerDistribution = scoped
            .GroupBy(x => x.Lot.Broker ?? "(unspecified)")
            .Select(g =>
            {
                var lots = g.Select(x => x.Lot).ToList();
                var soldLots = lots.Where(TopPriceEngine.IsSold).ToList();
                var qtySold = soldLots.Sum(l => l.NetWeight ?? 0);
                var proceeds = soldLots.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                return new BrokerDistributionRowDto(
                    g.Key, lots.Count, totalLots > 0 ? Math.Round(lots.Count * 100.0 / totalLots, 1) : 0,
                    lots.Select(l => l.SellingMark).Where(m => !string.IsNullOrWhiteSpace(m)).Distinct().Count(),
                    lots.Sum(l => l.NetWeight ?? 0), qtySold, proceeds,
                    qtySold > 0 ? Math.Round(proceeds / qtySold, 2) : 0);
            })
            .OrderByDescending(r => r.Lots)
            .ToList();
        var brokerOrder = brokerDistribution.Select(b => b.Broker).ToList();

        // ---- sold / outsold / unsold, ordered the same as the distribution table ----
        var statusByBroker = scoped.GroupBy(x => x.Lot.Broker ?? "(unspecified)")
            .ToDictionary(g => g.Key, g =>
            {
                var lots = g.Select(x => x.Lot).ToList();
                var sold = lots.Count(TopPriceEngine.IsSold);
                var outsold = lots.Count(TopPriceEngine.IsOutsold);
                var unsold = lots.Count(IsUnsold);
                var total = lots.Count;
                return new StatusRowDto(g.Key, sold, outsold, unsold, total,
                    total > 0 ? Math.Round(sold * 100.0 / total, 1) : 0,
                    total > 0 ? Math.Round(outsold * 100.0 / total, 1) : 0,
                    total > 0 ? Math.Round(unsold * 100.0 / total, 1) : 0);
            });
        var status = brokerOrder.Select(b => statusByBroker[b]).ToList();

        // ---- tiers, pooled across sales for the summary table ----
        var tieredLots = tierOf.ToList();
        var tiers = TierNames
            .Select(t =>
            {
                var rows = tieredLots.Where(kv => kv.Value == t).Select(kv => kv.Key).ToList();
                if (rows.Count == 0) return null;
                var qty = rows.Sum(l => l.NetWeight ?? 0);
                var proceeds = rows.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                var prices = rows.Select(l => l.PurchasedPrice ?? 0).ToList();
                return new TierRowDto(t, rows.Count, Math.Round(rows.Count * 100.0 / tieredLots.Count, 1),
                    qty, qty > 0 ? Math.Round(proceeds / qty, 2) : 0, prices.Min(), prices.Max());
            })
            .Where(r => r is not null).Select(r => r!)
            .ToList();

        // ---- tier x broker ----
        var tierByBroker = TierNames.SelectMany(t =>
            tieredLots.Where(kv => kv.Value == t).Select(kv => kv.Key)
                .GroupBy(l => l.Broker ?? "(unspecified)")
                .Select(g =>
                {
                    var qty = g.Sum(l => l.NetWeight ?? 0);
                    var proceeds = g.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                    return new TierBrokerRowDto(t, g.Key, g.Count(), qty, qty > 0 ? Math.Round(proceeds / qty, 2) : 0);
                })
        ).ToList();

        // ---- sale trend ----
        var trend = scoped.GroupBy(x => (x.SaleNo, x.SaleYear))
            .OrderBy(g => g.Key.SaleYear).ThenBy(g => g.Key.SaleNo)
            .Select(g =>
            {
                var lots = g.Select(x => x.Lot).ToList();
                var sold = lots.Where(TopPriceEngine.IsSold).ToList();
                var outsold = lots.Count(TopPriceEngine.IsOutsold);
                var unsold = lots.Count(IsUnsold);
                var qtyOffered = lots.Sum(l => l.NetWeight ?? 0);
                var qtySold = sold.Sum(l => l.NetWeight ?? 0);
                var proceeds = sold.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                return new SaleTrendRowDto(g.Key.SaleNo, g.Key.SaleYear, lots.Count, sold.Count, outsold, unsold,
                    lots.Count > 0 ? Math.Round(sold.Count * 100.0 / lots.Count, 1) : 0,
                    qtyOffered, qtySold, qtySold > 0 ? Math.Round(proceeds / qtySold, 2) : 0, proceeds);
            })
            .ToList();

        // ---- the flagship: Price & Classification, Sale x Broker ----
        var saleBroker = scoped
            .GroupBy(x => (x.SaleNo, x.SaleYear, Broker: x.Lot.Broker ?? "(unspecified)"))
            .Select(g =>
            {
                var lots = g.Select(x => x.Lot).ToList();
                var sold = lots.Where(TopPriceEngine.IsSold).ToList();
                var qtySold = sold.Sum(l => l.NetWeight ?? 0);
                var proceeds = sold.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                var avgPrice = qtySold > 0 ? Math.Round(proceeds / qtySold, 2) : 0;

                (int Lots, double SharePct, decimal Avg) TierStat(string tier)
                {
                    var tRows = sold.Where(l => tierOf.TryGetValue(l, out var t) && t == tier).ToList();
                    var tQty = tRows.Sum(l => l.NetWeight ?? 0);
                    var tProceeds = tRows.Sum(l => (l.NetWeight ?? 0) * (l.PurchasedPrice ?? 0));
                    return (tRows.Count, sold.Count > 0 ? Math.Round(tRows.Count * 100.0 / sold.Count, 1) : 0,
                        tQty > 0 ? Math.Round(tProceeds / tQty, 2) : 0);
                }

                var sb = TierStat("Select Best");
                var best = TierStat("Best");
                var bb = TierStat("Below Best");
                var poor = TierStat("Poor");

                return new SaleBrokerRowDto(
                    g.Key.SaleNo, g.Key.SaleYear, g.Key.Broker, lots.Count, sold.Count,
                    lots.Count > 0 ? Math.Round(sold.Count * 100.0 / lots.Count, 1) : 0, avgPrice,
                    sb.Lots, sb.SharePct, sb.Avg, best.Lots, best.SharePct, best.Avg,
                    bb.Lots, bb.SharePct, bb.Avg, poor.Lots, poor.SharePct, poor.Avg);
            })
            .OrderBy(r => r.SaleYear).ThenBy(r => r.SaleNo).ThenByDescending(r => r.Lots)
            .ToList();

        var summary = new CategoryAnalysisSummaryDto(
            totalLots,
            scoped.Count(x => TopPriceEngine.IsSold(x.Lot)),
            scoped.Count(x => TopPriceEngine.IsOutsold(x.Lot)),
            scoped.Count(x => IsUnsold(x.Lot)),
            brokerDistribution.Count,
            scoped.Select(x => x.Lot.SellingMark).Where(m => !string.IsNullOrWhiteSpace(m)).Distinct().Count());

        return new CategoryAnalysisDto(category, sales, summary, brokerDistribution, status, tiers, tierByBroker, trend, saleBroker);
    }
}
