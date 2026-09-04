using Asc.Api.Models;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Splits a lot group into the four "Valuation Centre" price tiers used by the printed
/// weekly market bulletin: sorted by price descending, top 25% of lots = Select Best,
/// next 30% = Best, next 30% = Below Best, bottom 15% = Poor. This is a distinct,
/// descending, lot-count-weighted split from the existing Classification/TierFor
/// backfill in SaleFileStore.cs (20/25/30/25, ascending, used for per-lot Classification
/// storage) — the two must not be confused or merged.
/// </summary>
public static class TierSplitter
{
    public const int SelectBest = 0;
    public const int Best = 1;
    public const int BelowBest = 2;
    public const int Poor = 3;

    public record PriceRange(decimal? Min, decimal? Max, int LotCount);

    public static readonly PriceRange Empty = new(null, null, 0);

    public static PriceRange[] ComputeFourTiers(IReadOnlyList<Lot> lots)
    {
        var sorted = lots
            .Where(l => l.PurchasedPrice.HasValue)
            .OrderByDescending(l => l.PurchasedPrice!.Value)
            .Select(l => l.PurchasedPrice!.Value)
            .ToList();

        var n = sorted.Count;
        if (n == 0) return [Empty, Empty, Empty, Empty];

        var cut1 = CutIndex(n, 0.25);
        var cut2 = CutIndex(n, 0.55);
        var cut3 = CutIndex(n, 0.85);

        return
        [
            RangeOf(sorted[..cut1]),
            RangeOf(sorted[cut1..cut2]),
            RangeOf(sorted[cut2..cut3]),
            RangeOf(sorted[cut3..]),
        ];
    }

    /// <summary>Combines a subset of the four computed tiers back into one range — min of
    /// mins, max of maxes, summed lot count. Used to merge e.g. Select Best + Best into a
    /// single "Best"/"Better" row, or all four into one untiered overall range.</summary>
    public static PriceRange Merge(PriceRange[] tiers, params int[] indices)
    {
        var selected = indices.Select(i => tiers[i]).Where(t => t.LotCount > 0).ToList();
        if (selected.Count == 0) return Empty;
        return new PriceRange(
            selected.Min(t => t.Min!.Value),
            selected.Max(t => t.Max!.Value),
            selected.Sum(t => t.LotCount));
    }

    private static int CutIndex(int n, double fraction) =>
        Math.Clamp((int)Math.Round(n * fraction, MidpointRounding.AwayFromZero), 0, n);

    private static PriceRange RangeOf(List<decimal> prices) =>
        prices.Count == 0 ? Empty : new PriceRange(prices.Min(), prices.Max(), prices.Count);
}
