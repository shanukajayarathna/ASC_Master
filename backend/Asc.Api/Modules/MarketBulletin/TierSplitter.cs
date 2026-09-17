using Asc.Api.Models;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Splits a lot group into the four "Valuation Centre" price tiers used by the printed
/// weekly market bulletin: sorted by price descending, top 15% of lots = Select Best,
/// next 30% = Best, next 40% = Below Best, bottom 15% = Poor (updated from the original
/// 20/35/30/15 split per the user's own instruction). This is a distinct, descending,
/// lot-count-weighted split from the existing Classification/TierFor backfill in
/// SaleFileStore.cs (20/25/30/25, ascending, used for per-lot Classification storage) —
/// the two must not be confused or merged.
/// </summary>
public static class TierSplitter
{
    public const int SelectBest = 0;
    public const int Best = 1;
    public const int BelowBest = 2;
    public const int Poor = 3;

    public record PriceRange(decimal? Min, decimal? Max, int LotCount, decimal QuantityKg);

    public static readonly PriceRange Empty = new(null, null, 0, 0);

    public static PriceRange[] ComputeFourTiers(IReadOnlyList<Lot> lots) =>
        SliceFourTiers(lots).Select(RangeOf).ToArray();

    /// <summary>The same 15/45/85 cumulative percentile cuts as ComputeFourTiers (15% Select
    /// Best, next 30% to 45% Best, next 40% to 85% Below Best, remaining 15% Poor), but
    /// returning each tier's actual LOTS rather than just their price range — for a caller that
    /// needs more than min/max, e.g. total quantity or a quantity-weighted average price per
    /// tier (see MarketBulletinMonthlyEngine). Kept as the one place this cut logic lives so
    /// both consumers can never quietly drift out of sync on where a tier boundary falls.</summary>
    public static List<Lot>[] SliceFourTiers(IReadOnlyList<Lot> lots)
    {
        var sorted = lots
            .Where(l => l.PurchasedPrice.HasValue)
            .OrderByDescending(l => l.PurchasedPrice!.Value)
            .ToList();

        var n = sorted.Count;
        var cut1 = CutIndex(n, 0.15);
        var cut2 = CutIndex(n, 0.45);
        var cut3 = CutIndex(n, 0.85);

        return [sorted[..cut1], sorted[cut1..cut2], sorted[cut2..cut3], sorted[cut3..]];
    }

    /// <summary>Combines a subset of the four computed tiers back into one range — min of
    /// mins, max of maxes, summed lot count and quantity. Used to merge e.g. Select Best + Best
    /// into a single "Best"/"Better" row, or all four into one untiered overall range.</summary>
    public static PriceRange Merge(PriceRange[] tiers, params int[] indices)
    {
        var selected = indices.Select(i => tiers[i]).Where(t => t.LotCount > 0).ToList();
        if (selected.Count == 0) return Empty;
        return new PriceRange(
            selected.Min(t => t.Min!.Value),
            selected.Max(t => t.Max!.Value),
            selected.Sum(t => t.LotCount),
            selected.Sum(t => t.QuantityKg));
    }

    private static int CutIndex(int n, double fraction) =>
        Math.Clamp((int)Math.Round(n * fraction, MidpointRounding.AwayFromZero), 0, n);

    private static PriceRange RangeOf(List<Lot> tierLots) =>
        tierLots.Count == 0
            ? Empty
            : new PriceRange(
                tierLots.Min(l => l.PurchasedPrice!.Value),
                tierLots.Max(l => l.PurchasedPrice!.Value),
                tierLots.Count,
                tierLots.Sum(l => l.NetWeight ?? 0m));
}
