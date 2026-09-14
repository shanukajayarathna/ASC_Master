using Asc.Api.Data;
using Asc.Api.Models;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Read side over the pre-aggregated FactoryMarkPerformanceFact/PreSaleCatalogueFact
/// collections — no live computation from raw lots here, only summing/re-deriving weighted
/// averages across however many already-mined per-sale documents a request's range covers.
/// Comparison is not a separate feature: CompareFactoryOrMarkPerformanceAsync is a thin loop
/// over the same single-code methods, nothing more.
/// </summary>
public class FactoryMarkPerformanceService(MongoContext db)
{
    public const int MaxCompareCodes = 4;
    private const int TrailingSalesWindow = 6;
    private const int MaxUpcomingSales = 3;

    public async Task<FactoryMarkPerformanceSummaryDto> GetFactoryPerformanceAsync(
        string factoryCode, int fromYear, int fromSaleNo, int toYear, int toSaleNo, CancellationToken ct)
    {
        var filter = RangeFilter(FactoryMarkPerformanceScope.Factory, fromYear, fromSaleNo, toYear, toSaleNo)
            & Builders<FactoryMarkPerformanceFact>.Filter.Eq(f => f.FactoryCode, factoryCode);
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var docs = await db.FactoryMarkPerformanceFacts.Find(filter).ToListAsync(ct);
        return Summarize("Factory", factoryCode, null, fromYear, fromSaleNo, toYear, toSaleNo, docs);
    }

    public async Task<FactoryMarkPerformanceSummaryDto> GetMarkPerformanceAsync(
        string markCode, int fromYear, int fromSaleNo, int toYear, int toSaleNo, CancellationToken ct)
    {
        var filter = RangeFilter(FactoryMarkPerformanceScope.Mark, fromYear, fromSaleNo, toYear, toSaleNo)
            & Builders<FactoryMarkPerformanceFact>.Filter.Eq(f => f.MarkCode, markCode);
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var docs = await db.FactoryMarkPerformanceFacts.Find(filter).ToListAsync(ct);
        var factoryCode = docs.Count > 0 ? docs[0].FactoryCode : "";
        return Summarize("Mark", factoryCode, markCode, fromYear, fromSaleNo, toYear, toSaleNo, docs);
    }

    /// <summary>Compound filter on (Scope, SaleYear, SaleNo) so the range is evaluated by
    /// MongoDB against the indexes added in MongoContext.CreateIndexes(), rather than fetching
    /// every historical fact for a code and filtering client-side — matters once the backfill
    /// deepens past the initial ~2-year window.</summary>
    private static FilterDefinition<FactoryMarkPerformanceFact> RangeFilter(
        FactoryMarkPerformanceScope scope, int fromYear, int fromSaleNo, int toYear, int toSaleNo)
    {
        var fb = Builders<FactoryMarkPerformanceFact>.Filter;
        var afterFrom = fb.Or(
            fb.Gt(f => f.SaleYear, fromYear),
            fb.And(fb.Eq(f => f.SaleYear, fromYear), fb.Gte(f => f.SaleNo, fromSaleNo)));
        var beforeTo = fb.Or(
            fb.Lt(f => f.SaleYear, toYear),
            fb.And(fb.Eq(f => f.SaleYear, toYear), fb.Lte(f => f.SaleNo, toSaleNo)));
        return fb.Eq(f => f.Scope, scope) & afterFrom & beforeTo;
    }

    /// <summary>Just fetches N summaries and returns them side by side — no comparison
    /// engine, no diffing. The caller (the controller) enforces MaxCompareCodes.</summary>
    public async Task<IReadOnlyList<FactoryMarkPerformanceSummaryDto>> CompareFactoryOrMarkPerformanceAsync(
        IReadOnlyList<string> codes, bool isFactory, int fromYear, int fromSaleNo, int toYear, int toSaleNo, CancellationToken ct)
    {
        var results = new List<FactoryMarkPerformanceSummaryDto>();
        foreach (var code in codes)
            results.Add(isFactory
                ? await GetFactoryPerformanceAsync(code, fromYear, fromSaleNo, toYear, toSaleNo, ct)
                : await GetMarkPerformanceAsync(code, fromYear, fromSaleNo, toYear, toSaleNo, ct));
        return results;
    }

    /// <summary>Pure aggregation of whichever per-sale facts already fell in the requested
    /// range — weighted average recomputed across them, not an average of their own AvgPriceRs
    /// values. Internal so Asc.Api.Tests can exercise it directly.</summary>
    internal static FactoryMarkPerformanceSummaryDto Summarize(
        string scope, string factoryCode, string? markCode, int fromYear, int fromSaleNo, int toYear, int toSaleNo,
        IReadOnlyList<FactoryMarkPerformanceFact> docsInRange)
    {
        // Derived entirely from GradeMix (not each doc's own cached TotalWeightKg/
        // TotalProceedsRs) so there is exactly one source of truth within this function —
        // the two agree for real mined data (BuildFact computes both from the same grade
        // totals), but re-deriving from GradeMix here means a doc whose cached totals ever
        // drifted from its own grade mix still summarizes correctly.
        var gradeTotals = new Dictionary<string, (decimal Weight, decimal Proceeds, string Category)>(StringComparer.OrdinalIgnoreCase);
        foreach (var doc in docsInRange)
            foreach (var g in doc.GradeMix)
            {
                var existing = gradeTotals.GetValueOrDefault(g.Grade);
                gradeTotals[g.Grade] = (existing.Weight + g.WeightKg, existing.Proceeds + g.WeightKg * g.AvgPriceRs, g.Category);
            }

        var totalWeight = gradeTotals.Values.Sum(v => v.Weight);
        var totalProceeds = gradeTotals.Values.Sum(v => v.Proceeds);

        var gradeMix = gradeTotals.Select(kv => new GradeMixEntryDto(
            kv.Key, kv.Value.Category, kv.Value.Weight,
            totalWeight > 0 ? kv.Value.Weight / totalWeight * 100m : 0m,
            kv.Value.Weight > 0 ? kv.Value.Proceeds / kv.Value.Weight : 0m)).ToList();

        var eligible = gradeMix.Where(g => !FactoryMarkPerformanceMiningService.NonTopPriceCategories.Contains(g.Category)).ToList();
        var bestPrice = eligible.Count > 0 ? eligible.Max(g => g.AvgPriceRs) : 0m;
        var bestGrades = eligible.Where(g => g.AvgPriceRs == bestPrice && bestPrice > 0).Select(g => g.Grade).ToList();

        return new FactoryMarkPerformanceSummaryDto(
            scope, factoryCode, markCode, fromYear, fromSaleNo, toYear, toSaleNo,
            totalProceeds, totalWeight, totalWeight > 0 ? totalProceeds / totalWeight : 0m,
            gradeMix, bestGrades, docsInRange.Count);
    }

    /// <summary>Backs the Comparison tab's factory picker — same by-code-or-name regex
    /// approach as MarkIntelligenceController.Search, scoped to Factory.</summary>
    public async Task<List<FactorySearchResultDto>> SearchFactoriesAsync(string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q)) return [];
        var filter = Builders<Factory>.Filter.Or(
            Builders<Factory>.Filter.Regex(f => f.Code, new BsonRegularExpression(q, "i")),
            Builders<Factory>.Filter.Regex(f => f.Name, new BsonRegularExpression(q, "i")));
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var factories = await db.Factories.Find(filter).Limit(50).ToListAsync(ct);
        return factories.Select(f => new FactorySearchResultDto(f.Code, f.Name)).ToList();
    }

    // ---- forward estimate --------------------------------------------------------------

    /// <summary>Arithmetic over two existing data sources — no forecasting model, no AI call.
    /// See PreSaleCatalogueFact's own doc comment for why this reads opportunistically
    /// (0-3 upcoming sales, whichever actually have an uploaded pre-sale catalogue).</summary>
    public async Task<ForwardEstimateSummaryDto> GetForwardEstimateAsync(string code, bool isFactory, CancellationToken ct)
    {
        var factoryCode = isFactory ? code : null;
        var markCode = isFactory ? null : code;

        List<string> markCodesInScope;
        if (isFactory)
        {
            // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
            var factory = await db.Factories.Find(f => f.Code == code).FirstOrDefaultAsync(ct);
            if (factory is null) return EmptyForwardEstimate("Factory", code, null);
            // Filtered on the real stored field (AscActivityStatus), not the computed
            // IsCurrentlyOurs property — the MongoDB LINQ provider can't translate a computed
            // C# property into a server-side query (confirmed live: ExpressionNotSupportedException).
            // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
            var marks = await db.Marks.Find(m => m.FactoryId == factory.Id && m.AscActivityStatus != AscActivityStatus.Lost).ToListAsync(ct);
            markCodesInScope = marks.Select(m => m.Code).ToList();
        }
        else
        {
            markCodesInScope = [code];
        }
        if (markCodesInScope.Count == 0) return EmptyForwardEstimate(isFactory ? "Factory" : "Mark", factoryCode ?? "", markCode);

        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var snapshots = await db.PreSaleCatalogueFacts.Find(s => markCodesInScope.Contains(s.MarkCode)).ToListAsync(ct);
        if (snapshots.Count == 0) return EmptyForwardEstimate(isFactory ? "Factory" : "Mark", factoryCode ?? "", markCode);

        // A snapshot's sale may have since actually closed and been mined for real — exclude
        // those so a stale pre-sale snapshot never shadows the real, already-known outcome.
        var relevantYears = snapshots.Select(s => s.SaleYear).Distinct().ToList();
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var closedTuples = (await db.FactoryMarkPerformanceFacts
                .Find(f => f.Scope == FactoryMarkPerformanceScope.Mark && f.MarkCode != null && markCodesInScope.Contains(f.MarkCode) && relevantYears.Contains(f.SaleYear))
                .ToListAsync(ct))
            .Select(f => (f.MarkCode!, f.SaleYear, f.SaleNo))
            .ToHashSet();
        var openSnapshots = snapshots.Where(s => !closedTuples.Contains((s.MarkCode, s.SaleYear, s.SaleNo))).ToList();
        if (openSnapshots.Count == 0) return EmptyForwardEstimate(isFactory ? "Factory" : "Mark", factoryCode ?? "", markCode);

        var upcomingPeriods = openSnapshots.Select(s => (s.SaleYear, s.SaleNo)).Distinct()
            .OrderBy(p => p.SaleYear).ThenBy(p => p.SaleNo)
            .Take(MaxUpcomingSales)
            .ToHashSet();
        var chosenSnapshots = openSnapshots.Where(s => upcomingPeriods.Contains((s.SaleYear, s.SaleNo))).ToList();

        var futureWeightByGrade = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var snap in chosenSnapshots)
            foreach (var g in snap.GradeMix)
                futureWeightByGrade[g.Grade] = futureWeightByGrade.GetValueOrDefault(g.Grade) + g.WeightKg;

        // ---- trailing weighted-avg price per grade, own scope first ----
        var ownTrailingQuery = isFactory
            ? db.FactoryMarkPerformanceFacts.Find(f => f.Scope == FactoryMarkPerformanceScope.Factory && f.FactoryCode == code)
            : db.FactoryMarkPerformanceFacts.Find(f => f.Scope == FactoryMarkPerformanceScope.Mark && f.MarkCode == code);
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var ownTrailingDocs = (await ownTrailingQuery.ToListAsync(ct))
            .OrderByDescending(d => d.SaleYear).ThenByDescending(d => d.SaleNo)
            .Take(TrailingSalesWindow)
            .ToList();
        var ownGradeStats = AggregateGradeWeightedAvg(ownTrailingDocs);
        var resolvedFactoryCode = factoryCode ?? ownTrailingDocs.FirstOrDefault()?.FactoryCode;

        // ---- factory-wide fallback (only meaningful for a mark-level request — a factory
        // request's own scope already IS factory-wide) ----
        var factoryGradeStats = new Dictionary<string, (decimal Weight, decimal Proceeds)>(StringComparer.OrdinalIgnoreCase);
        if (!isFactory)
        {
            resolvedFactoryCode ??= await ResolveFactoryCodeForMarkAsync(code, ct);
            if (!string.IsNullOrEmpty(resolvedFactoryCode))
            {
                // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
                var factoryTrailingDocs = (await db.FactoryMarkPerformanceFacts
                        .Find(f => f.Scope == FactoryMarkPerformanceScope.Factory && f.FactoryCode == resolvedFactoryCode)
                        .ToListAsync(ct))
                    .OrderByDescending(d => d.SaleYear).ThenByDescending(d => d.SaleNo)
                    .Take(TrailingSalesWindow)
                    .ToList();
                factoryGradeStats = AggregateGradeWeightedAvg(factoryTrailingDocs);
            }
        }

        var gradeBreakdown = BuildGradeBreakdown(futureWeightByGrade, ownGradeStats, factoryGradeStats);
        var estimatedTotalProceeds = gradeBreakdown.Sum(g => g.EstimatedValueRs);
        var estimatedTotalWeight = gradeBreakdown.Sum(g => g.EstimatedWeightKg);
        var withContribution = gradeBreakdown
            .Select(g => g with { ContributionPct = estimatedTotalProceeds > 0 ? g.EstimatedValueRs / estimatedTotalProceeds * 100m : 0m })
            .ToList();

        return new ForwardEstimateSummaryDto(
            isFactory ? "Factory" : "Mark", resolvedFactoryCode ?? factoryCode ?? "", markCode,
            upcomingPeriods.OrderBy(p => p.SaleYear).ThenBy(p => p.SaleNo).Select(p => new ForwardEstimateSaleDto(p.SaleYear, p.SaleNo)).ToList(),
            estimatedTotalProceeds, estimatedTotalWeight,
            estimatedTotalWeight > 0 ? estimatedTotalProceeds / estimatedTotalWeight : 0m,
            withContribution);
    }

    /// <summary>Pure per-grade estimate build — no I/O. Internal so Asc.Api.Tests can
    /// exercise the factory-wide-fallback and insufficient-data paths directly.</summary>
    internal static List<ForwardEstimateGradeDto> BuildGradeBreakdown(
        IReadOnlyDictionary<string, decimal> futureWeightByGrade,
        IReadOnlyDictionary<string, (decimal Weight, decimal Proceeds)> ownGradeStats,
        IReadOnlyDictionary<string, (decimal Weight, decimal Proceeds)> factoryGradeStats)
    {
        var result = new List<ForwardEstimateGradeDto>();
        foreach (var (grade, futureWeight) in futureWeightByGrade)
        {
            bool usedFallback = false, hasData = true;
            decimal trailingAvgPrice;
            if (ownGradeStats.TryGetValue(grade, out var own) && own.Weight > 0)
            {
                trailingAvgPrice = own.Proceeds / own.Weight;
            }
            else if (factoryGradeStats.TryGetValue(grade, out var fac) && fac.Weight > 0)
            {
                trailingAvgPrice = fac.Proceeds / fac.Weight;
                usedFallback = true;
            }
            else
            {
                trailingAvgPrice = 0m;
                hasData = false;
            }
            result.Add(new ForwardEstimateGradeDto(grade, futureWeight, trailingAvgPrice, futureWeight * trailingAvgPrice, 0m, usedFallback, hasData));
        }
        return result;
    }

    private static Dictionary<string, (decimal Weight, decimal Proceeds)> AggregateGradeWeightedAvg(IEnumerable<FactoryMarkPerformanceFact> docs)
    {
        var result = new Dictionary<string, (decimal Weight, decimal Proceeds)>(StringComparer.OrdinalIgnoreCase);
        foreach (var doc in docs)
            foreach (var g in doc.GradeMix)
            {
                var existing = result.GetValueOrDefault(g.Grade);
                result[g.Grade] = (existing.Weight + g.WeightKg, existing.Proceeds + g.WeightKg * g.AvgPriceRs);
            }
        return result;
    }

    private async Task<string?> ResolveFactoryCodeForMarkAsync(string markCode, CancellationToken ct)
    {
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var mark = await db.Marks.Find(m => m.Code == markCode).FirstOrDefaultAsync(ct);
        if (mark is null) return null;
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var factory = await db.Factories.Find(f => f.Id == mark.FactoryId).FirstOrDefaultAsync(ct);
        return factory?.Code;
    }

    private static ForwardEstimateSummaryDto EmptyForwardEstimate(string scope, string factoryCode, string? markCode) =>
        new(scope, factoryCode, markCode, [], 0m, 0m, 0m, []);

    // ---- opportunistic pre-sale snapshot capture ----------------------------------------

    /// <summary>Called from SharedMarkCatalogueController right after it parses a sale's raw
    /// pre-sale broker uploads — a pure additive side-effect alongside the existing report
    /// generation, so the forward estimate has real grade+weight data to read. Keyed by
    /// MarkCode (normalized Selling Mark), not FactoryCode, since the raw upload files' own
    /// Factory/Trade-Mark code scheme doesn't match Factory.Code's MslCode scheme — see
    /// PreSaleCatalogueFact's own doc comment.</summary>
    public async Task SavePreSaleSnapshotAsync(int saleYear, int saleNo, IReadOnlyList<Lot> uploadedLots, CancellationToken ct)
    {
        var byMark = uploadedLots
            .Where(l => !l.IsReprint && !string.IsNullOrWhiteSpace(l.SellingMark) && l.NetWeight is > 0)
            .GroupBy(l => l.SellingMark!.Trim().ToUpperInvariant(), StringComparer.OrdinalIgnoreCase);

        foreach (var group in byMark)
        {
            var gradeMix = group
                .GroupBy(l => string.IsNullOrWhiteSpace(l.Grade) ? "(No grade)" : l.Grade!.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => new GradeWeightEntry { Grade = g.Key, WeightKg = g.Sum(x => x.NetWeight!.Value) })
                .ToList();

            var fact = new PreSaleCatalogueFact
            {
                MarkCode = group.Key,
                SaleYear = saleYear,
                SaleNo = saleNo,
                GradeMix = gradeMix,
                UploadedAt = DateTime.UtcNow,
            };

            var filter = Builders<PreSaleCatalogueFact>.Filter.Where(f => f.MarkCode == fact.MarkCode && f.SaleYear == saleYear && f.SaleNo == saleNo);
            // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
            var existing = await db.PreSaleCatalogueFacts.Find(filter).FirstOrDefaultAsync(ct);
            // See FactoryMarkPerformanceMiningService.UpsertFactAsync's own comment: ObjectId
            // isn't auto-generated on an upsert ReplaceOneAsync, only on Insert*Async — without
            // this, every new snapshot in the same batch would collide on the same all-zero id.
            fact.Id = existing?.Id ?? ObjectId.GenerateNewId();
            // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
            await db.PreSaleCatalogueFacts.ReplaceOneAsync(filter, fact, new ReplaceOptions { IsUpsert = true }, ct);
        }
    }
}
