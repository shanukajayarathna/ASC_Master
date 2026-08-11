using Asc.Api.Data;
using Asc.Api.Modules.MasterData;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Performance;

/// <summary>
/// The first cross-sale computation in this codebase — every other analytics surface
/// (Analytics/Market/Broker/TopPriceEngine) is scoped to one sale at a time. Two insight
/// types, both read-only, both using real-unit thresholds (a minimum sample size + an
/// absolute magnitude floor) mirroring MarketController.ComputeInsights's existing
/// philosophy — no invented statistical tests. Streak/swing detection is pure and static so
/// it's unit-testable without ICatalogueSource/Mongo (see Asc.Api.Tests).
/// </summary>
public class PerformanceEngine(ICatalogueSource source, MongoContext db, MasterDataResolver masterData)
{
    // "3 sales running" is the roadmap's own example language; Rs. 5/kg is a real-unit
    // floor (not a percentage or p-value) below which a swing isn't worth surfacing.
    internal const int MinGradeStreakSales = 3;
    internal const decimal MinGradeStreakMagnitude = 5m;

    // Mirrors MarketController.ComputeInsights's own Take(6) — the point isn't "only this
    // many trends are real," it's not dumping every grade/buyer that technically cleared
    // the floor onto one screen. Verified against the real 33-sale dataset: with only 2-3
    // prior sales as a baseline, dozens of buyers clear the swing floor in any given week
    // (real week-to-week lumpiness in auction buying, not noise) — ranking by magnitude and
    // capping keeps this a shortlist of the most significant movers, not a full dump.
    private const int MaxInsightsPerDimension = 8;

    // Grade history comes from SaleFileStore's slim valued-lots cache (Grade+Valuation
    // only), the same cheap cross-sale source CataloguesController.PreviousGradeStats
    // already uses — safe to look back further than the full-lot window below.
    private const int DefaultGradeSalesWindow = 8;

    // Buyer/PurchasedPrice/NetWeight aren't in the slim cache, so this needs a full
    // GetLots(catalogueId) per sale — bounded to the same ceiling SaleFileStore's
    // in-memory LRU (MaxLoadedSales) and AssistantTools.MaxCompareSales already respect,
    // for the same reason: looking back further would repeatedly evict and re-parse
    // (~25s cold per file) rather than serve from cache.
    private const int DefaultBuyerSalesWindow = 4;
    private const int MinBuyerLotsMostRecent = 5;
    private const double MinBuyerSwingPercent = 20.0;

    public async Task<List<PerformanceInsightDto>> AllInsights(CancellationToken ct = default)
    {
        var grade = await GradeTrends(ct: ct);
        var buyer = await BuyerTrends(ct: ct);
        return [.. grade, .. buyer];
    }

    /// <summary>Known limitation, inherited from the same slim-cache source
    /// CataloguesController.PreviousGradeStats already uses: BuildSlim only captures lots
    /// that already carry a file-embedded valuation when the sale's slim cache was written.
    /// A Mongo override on a lot that was never file-valued (valued for the first time
    /// through this app, not pre-filled in the Excel) still applies correctly to a slim row
    /// that's already present, but a lot with *only* an override and no file valuation is
    /// invisible to this method — the live per-catalogue Analytics breakdown (which loads
    /// full lots) can therefore show a slightly different average for an old sale than this
    /// does. Accepted the same way PreviousGradeStats already accepts it: the alternative is
    /// full-loading every sale in an 8-sale window, which defeats the reason this uses the
    /// slim cache at all.</summary>
    public async Task<List<PerformanceInsightDto>> GradeTrends(int salesWindow = DefaultGradeSalesWindow, CancellationToken ct = default)
    {
        // The single most recent sale is very often still being valued (0 completed
        // tickets) right up until it closes — that's not "a data point where nothing
        // happened," it's not a data point at all, and treating it as one would break
        // every grade's streak before it starts. A few sales of headroom past the
        // requested window absorbs that without inflating the window itself.
        var candidates = source.ListCatalogues().Take(salesWindow + 5).ToList(); // already newest-first

        var saleIds = candidates.Select(s => s.Id).ToList();
        var overridesBySale = (await db.Valuations.Find(v => saleIds.Contains(v.CatalogueId)).ToListAsync(ct))
            .ToLookup(v => v.CatalogueId);

        // Index 0 = most recent VALUED sale, not necessarily the most recent sale overall.
        var perSaleGradeAverages = candidates
            .Select(sale =>
            {
                var overrides = overridesBySale[sale.Id].ToDictionary(v => v.LotId, v => v.Valuation);
                return source.GetValuedSlim(sale.Id)
                    .Select(l => (Grade: masterData.Resolve(MasterDataEntityType.Grade, l.Grade), Valuation: overrides.GetValueOrDefault(l.LotId, l.Valuation)))
                    .Where(l => !string.IsNullOrWhiteSpace(l.Grade) && l.Valuation.EffectiveValue.HasValue)
                    .GroupBy(l => l.Grade!)
                    .ToDictionary(g => g.Key, g => g.Average(l => l.Valuation.EffectiveValue!.Value));
            })
            .Where(d => d.Count > 0)
            .Take(salesWindow)
            .ToList();

        if (perSaleGradeAverages.Count < MinGradeStreakSales) return [];

        var insights = new List<PerformanceInsightDto>();
        foreach (var grade in perSaleGradeAverages.SelectMany(d => d.Keys).Distinct())
        {
            // Only sales where this grade actually appears, most-recent-first, stopping at
            // the first gap — a grade skipping a sale breaks the streak rather than papering
            // over it with a earlier sale's value.
            var series = new List<decimal>();
            foreach (var saleAverages in perSaleGradeAverages)
            {
                if (!saleAverages.TryGetValue(grade, out var avg)) break;
                series.Add(avg);
            }

            if (DetectStreak(series) is not { } s) continue;

            insights.Add(new PerformanceInsightDto(
                "Grade", grade, s.Direction, (double)Math.Abs(s.TotalSwing), "Rs./kg", s.SalesSpan,
                $"{grade} has {(s.Direction == "up" ? "strengthened" : "weakened")} for {s.SalesSpan} sales running, " +
                $"{s.Direction} about Rs. {Math.Abs(s.TotalSwing):0} per kg over that span."));
        }

        return [.. insights.OrderByDescending(i => i.Magnitude).Take(MaxInsightsPerDimension)];
    }

    public Task<List<PerformanceInsightDto>> BuyerTrends(int salesWindow = DefaultBuyerSalesWindow, CancellationToken ct = default)
    {
        // Buyer/PurchasedPrice only get populated once a sale actually settles — the most
        // recently *created* catalogue is very often still being valued pre-auction, with
        // no purchase data at all yet. A small amount of headroom (not the same +5 used for
        // the cheap slim-cache grade trend) skips a pending sale without loading more full
        // sale files than the LRU cache the rest of this app already sizes around.
        var candidates = source.ListCatalogues().Take(salesWindow + 2).ToList(); // already newest-first

        // Index 0 = most recent sale with any purchase activity at all.
        var perSaleBuyerCounts = candidates
            .Select(sale =>
            {
                var lots = source.GetLots(sale.Id) ?? [];
                return lots
                    .Where(l => l.PurchasedPrice.HasValue && (!string.IsNullOrWhiteSpace(l.Buyer) || !string.IsNullOrWhiteSpace(l.BuyerName)))
                    .Select(l => masterData.Resolve(MasterDataEntityType.Buyer, string.IsNullOrWhiteSpace(l.BuyerName) ? l.Buyer : l.BuyerName))
                    .Where(b => !string.IsNullOrWhiteSpace(b))
                    .GroupBy(b => b!)
                    .ToDictionary(g => g.Key, g => g.Count());
            })
            .Where(d => d.Count > 0)
            .Take(salesWindow)
            .ToList();

        if (perSaleBuyerCounts.Count < 2) return Task.FromResult(new List<PerformanceInsightDto>());

        var mostRecent = perSaleBuyerCounts[0];
        var priorSales = perSaleBuyerCounts.Skip(1).ToList();

        var insights = new List<PerformanceInsightDto>();
        foreach (var (buyer, mostRecentCount) in mostRecent)
        {
            var priorCounts = priorSales.Select(s => s.GetValueOrDefault(buyer)).Where(c => c > 0).ToList();
            if (DetectSwingPercent(mostRecentCount, priorCounts) is not { } sw) continue;

            insights.Add(new PerformanceInsightDto(
                "Buyer", buyer, sw.Direction, Math.Abs(sw.SwingPercent), "% vs. recent average", perSaleBuyerCounts.Count,
                $"{buyer} {sw.Direction} purchases by about {Math.Abs(sw.SwingPercent):0}% in the latest sale " +
                $"({mostRecentCount} lots) versus their recent average across the last {perSaleBuyerCounts.Count} sales."));
        }

        return Task.FromResult(insights.OrderByDescending(i => i.Magnitude).Take(MaxInsightsPerDimension).ToList());
    }

    /// <summary>Walks backward from the most recent value counting a consecutive
    /// same-direction run. Pure — no Mongo/ICatalogueSource — so it's directly
    /// unit-testable. `mostRecentFirst[0]` is the latest sale's value.</summary>
    internal static (int SalesSpan, decimal TotalSwing, string Direction)? DetectStreak(IReadOnlyList<decimal> mostRecentFirst)
    {
        if (mostRecentFirst.Count < 2) return null;

        var firstDiff = mostRecentFirst[0] - mostRecentFirst[1];
        if (firstDiff == 0) return null;
        var goingUp = firstDiff > 0;

        var span = 1;
        for (var i = 1; i < mostRecentFirst.Count; i++)
        {
            var diff = mostRecentFirst[i - 1] - mostRecentFirst[i];
            if (goingUp ? diff <= 0 : diff >= 0) break;
            span++;
        }

        if (span < MinGradeStreakSales) return null;

        var totalSwing = mostRecentFirst[0] - mostRecentFirst[span - 1];
        if (Math.Abs(totalSwing) < MinGradeStreakMagnitude) return null;

        return (span, totalSwing, goingUp ? "up" : "down");
    }

    /// <summary>Pure — no Mongo/ICatalogueSource. `priorCounts` holds only the sales in the
    /// window (excluding the most recent) where the buyer actually bought something; an
    /// empty list means "not enough history," not "zero, so infinite swing."</summary>
    internal static (double SwingPercent, string Direction)? DetectSwingPercent(int mostRecentCount, IReadOnlyList<int> priorCounts)
    {
        if (priorCounts.Count == 0) return null;
        if (mostRecentCount < MinBuyerLotsMostRecent) return null;

        var priorAverage = priorCounts.Average();
        if (priorAverage <= 0) return null;

        var swingPercent = (mostRecentCount - priorAverage) / priorAverage * 100.0;
        if (Math.Abs(swingPercent) < MinBuyerSwingPercent) return null;

        return (swingPercent, swingPercent > 0 ? "increased" : "decreased");
    }
}
