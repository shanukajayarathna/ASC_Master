using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;
using Asc.Api.Services;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

public record SaleMiningResult(int SaleYear, int SaleNo, FactoryMarkPerformanceSource Source, int MarkFactsWritten, int FactoryFactsWritten);

/// <summary>
/// Computes FactoryMarkPerformanceFact for one sale at a time — called by
/// FactoryMarkPerformanceReportJob for each newly-closed sale, and by the manual backfill
/// endpoint in a loop over historical periods. Safe to re-run for the same period (upsert by
/// natural key), matching MarkIntelligenceMiningService/MarkAscActivityCheckService's own
/// re-run philosophy.
///
/// Reconciliation: /data/sales (ICatalogueSource) is authoritative when it has a file for this
/// exact period — that file's own General Report is already a consolidated, all-broker sheet
/// (see SharedMarkCatalogueService's doc comment), not ASC-only — otherwise the Msl archive
/// (AuctionLot) is used instead. This mirrors MarkAscActivityCheckService's own recency-cutover
/// precedent rather than inventing a broker-ownership split; exactly one source feeds any given
/// document.
///
/// Only marks that already exist in the Marks collection are evaluated — same rule
/// MarkAscActivityCheckService applies — a mark with no MSL-mined Factory/Mark record yet is
/// out of scope here rather than fabricated from a sale-file row alone.
/// </summary>
public class FactoryMarkPerformanceMiningService(MongoContext db, ICatalogueSource catalogues, ILogger<FactoryMarkPerformanceMiningService> logger)
{
    private sealed record RawLotFact(string MarkCode, string Grade, decimal WeightKg, decimal PriceRs);

    private static readonly Dictionary<string, string> GradeCategoryByNormalizedGrade = BuildGradeCategoryMap();

    private static Dictionary<string, string> BuildGradeCategoryMap()
    {
        var map = new Dictionary<string, string>();
        void AddAll(IEnumerable<string> grades, string category)
        {
            foreach (var g in grades)
            {
                var key = NormalizeGradeKey(g);
                map.TryAdd(key, category);
            }
        }
        // Priority order when a grade string appears in more than one of TopPriceEngine's own
        // lists (e.g. "PF" is in both CtcGrades and OffGrades there) — first-wins, same
        // ambiguity TopPriceEngine itself already has, not something to resolve differently here.
        AddAll(TopPriceEngine.MainGradeOrder, "Main");
        AddAll(TopPriceEngine.PremiumFloweryGradeOrder, "PremiumFlowery");
        AddAll(TopPriceEngine.CtcGrades, "Ctc");
        AddAll(TopPriceEngine.OffGrades, "Off");
        AddAll(TopPriceEngine.DustGrades, "Dust");
        return map;
    }

    private static string NormalizeGradeKey(string? value) =>
        new([.. (value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    /// <summary>Main | PremiumFlowery | Ctc | Off | Dust | Other.</summary>
    public static string ClassifyGradeCategory(string? grade) =>
        GradeCategoryByNormalizedGrade.GetValueOrDefault(NormalizeGradeKey(grade), "Other");

    /// <summary>Categories excluded from "best grade" — mirrors TopPriceEngine.NonTopPriceGrades.
    /// Internal so FactoryMarkPerformanceService's own range-summary rebuild (which re-derives
    /// BestGrades across several summed facts, not from a single mined document) applies the
    /// exact same rule rather than a second hand-copied list.</summary>
    internal static readonly HashSet<string> NonTopPriceCategories = new(StringComparer.OrdinalIgnoreCase) { "Ctc", "Off", "Dust" };

    /// <summary>Convenience single-period wrapper — see MineForSalesAsync, which every real
    /// caller (the job, the backfill loop) should prefer so the Marks/Factories load and the
    /// /data/sales catalogue scan are each paid once per batch, not once per period.</summary>
    public async Task<SaleMiningResult> MineForSaleAsync(int saleYear, int saleNo, CancellationToken ct)
    {
        var results = await MineForSalesAsync([(saleYear, saleNo)], ct);
        return results[0];
    }

    /// <summary>Mines any number of sale periods in one batch. Marks/Factories are loaded once
    /// and the /data/sales catalogue scan runs once (pre-filtered to the distinct years
    /// actually requested — Catalogue.Year is known from ListCatalogues() alone, so a
    /// catalogue from an irrelevant year is never even parsed) — the backfill endpoint calls
    /// this for its whole historical window rather than looping single-period calls, which
    /// would otherwise re-scan every /data/sales file once per period.</summary>
    public async Task<IReadOnlyList<SaleMiningResult>> MineForSalesAsync(IReadOnlyList<(int Year, int SaleNo)> periods, CancellationToken ct)
    {
        if (periods.Count == 0) return [];

        var dataSalesIndex = BuildDataSalesLotsIndex(periods);

        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var allMarks = await db.Marks.Find(FilterDefinition<Mark>.Empty).ToListAsync(ct);
        var marksByCode = allMarks.ToDictionary(m => m.Code, StringComparer.OrdinalIgnoreCase);
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var factoriesById = (await db.Factories.Find(FilterDefinition<Factory>.Empty).ToListAsync(ct)).ToDictionary(f => f.Id);

        var results = new List<SaleMiningResult>();
        foreach (var (year, saleNo) in periods)
            results.Add(await MineOnePeriodAsync(year, saleNo, dataSalesIndex, allMarks, marksByCode, factoriesById, ct));
        return results;
    }

    private async Task<SaleMiningResult> MineOnePeriodAsync(
        int saleYear, int saleNo, IReadOnlyDictionary<(int Year, int SaleNo), IReadOnlyList<Lot>> dataSalesIndex,
        List<Mark> allMarks, Dictionary<string, Mark> marksByCode, Dictionary<Guid, Factory> factoriesById, CancellationToken ct)
    {
        var dataSalesFileAvailable = dataSalesIndex.TryGetValue((saleYear, saleNo), out var dataSalesLots);
        var (rawFacts, source) = dataSalesFileAvailable
            ? (BuildRawFactsFromDataSales(dataSalesLots!), FactoryMarkPerformanceSource.DataSales)
            : (await BuildRawFactsFromArchiveAsync(saleYear, saleNo, ct), FactoryMarkPerformanceSource.MslArchive);

        var now = DateTime.UtcNow;
        var reconciliation = new FactoryMarkPerformanceSourceReconciliation { SourceUsed = source, DataSalesFileAvailable = dataSalesFileAvailable };

        // ---- Mark-level facts ----
        var markGradeTotals = new Dictionary<Guid, Dictionary<string, (decimal Weight, decimal Proceeds)>>();
        int markFactsWritten = 0;
        foreach (var group in rawFacts.GroupBy(f => f.MarkCode, StringComparer.OrdinalIgnoreCase))
        {
            if (!marksByCode.TryGetValue(group.Key, out var mark)) continue; // unresolved marks are out of scope, same rule MarkAscActivityCheckService applies
            if (!factoriesById.TryGetValue(mark.FactoryId, out var factory)) continue;

            var gradeTotals = group
                .GroupBy(f => f.Grade, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => (Weight: g.Sum(x => x.WeightKg), Proceeds: g.Sum(x => x.WeightKg * x.PriceRs)), StringComparer.OrdinalIgnoreCase);
            markGradeTotals[mark.Id] = new Dictionary<string, (decimal, decimal)>(gradeTotals, StringComparer.OrdinalIgnoreCase);

            var fact = BuildFact(FactoryMarkPerformanceScope.Mark, factory.Id, factory.Code, mark.Id, mark.Code, saleYear, saleNo, gradeTotals, reconciliation, now);
            await UpsertFactAsync(fact, ct);
            markFactsWritten++;
        }

        // ---- Factory-level facts: summed from this run's own mark-level grade totals, scoped
        // to marks ASC still actively brokers TODAY (Mark.IsCurrentlyOurs), not as of this
        // historical sale — see the module's design notes for why that's deliberate and cheap
        // to keep in sync. ----
        int factoryFactsWritten = 0;
        var eligibleMarkIdsByFactory = allMarks
            .Where(m => m.IsCurrentlyOurs && markGradeTotals.ContainsKey(m.Id))
            .GroupBy(m => m.FactoryId);
        foreach (var factoryGroup in eligibleMarkIdsByFactory)
        {
            if (!factoriesById.TryGetValue(factoryGroup.Key, out var factory)) continue;
            var combined = new Dictionary<string, (decimal Weight, decimal Proceeds)>(StringComparer.OrdinalIgnoreCase);
            foreach (var mark in factoryGroup)
            {
                foreach (var (grade, totals) in markGradeTotals[mark.Id])
                {
                    var existing = combined.GetValueOrDefault(grade);
                    combined[grade] = (existing.Weight + totals.Weight, existing.Proceeds + totals.Proceeds);
                }
            }
            if (combined.Count == 0) continue;

            var fact = BuildFact(FactoryMarkPerformanceScope.Factory, factory.Id, factory.Code, null, null, saleYear, saleNo, combined, reconciliation, now);
            await UpsertFactAsync(fact, ct);
            factoryFactsWritten++;
        }

        logger.LogInformation(
            "Factory & Mark performance mining [{Year}/{Sale}]: source={Source}, {MarkFacts} mark facts, {FactoryFacts} factory facts.",
            saleYear, saleNo, source, markFactsWritten, factoryFactsWritten);

        return new SaleMiningResult(saleYear, saleNo, source, markFactsWritten, factoryFactsWritten);
    }

    /// <summary>Pure grade-mix/best-grade/weighted-average core — no I/O. Internal (not
    /// private) so Asc.Api.Tests can exercise it directly, the same reason
    /// SharedMarkCatalogueService.FindRecentlySharedFactoryCodes is internal.</summary>
    internal static FactoryMarkPerformanceFact BuildFact(
        FactoryMarkPerformanceScope scope, Guid factoryId, string factoryCode, Guid? markId, string? markCode,
        int saleYear, int saleNo, Dictionary<string, (decimal Weight, decimal Proceeds)> gradeTotals,
        FactoryMarkPerformanceSourceReconciliation reconciliation, DateTime now)
    {
        var totalWeight = gradeTotals.Values.Sum(v => v.Weight);
        var totalProceeds = gradeTotals.Values.Sum(v => v.Proceeds);

        var gradeMix = gradeTotals.Select(kv => new GradeMixEntry
        {
            Grade = kv.Key,
            Category = ClassifyGradeCategory(kv.Key),
            WeightKg = kv.Value.Weight,
            PctOfTotal = totalWeight > 0 ? kv.Value.Weight / totalWeight * 100m : 0m,
            AvgPriceRs = kv.Value.Weight > 0 ? kv.Value.Proceeds / kv.Value.Weight : 0m,
        }).ToList();

        var eligibleForBest = gradeMix.Where(g => !NonTopPriceCategories.Contains(g.Category)).ToList();
        var bestPrice = eligibleForBest.Count > 0 ? eligibleForBest.Max(g => g.AvgPriceRs) : 0m;
        var bestGrades = eligibleForBest.Where(g => g.AvgPriceRs == bestPrice && bestPrice > 0).Select(g => g.Grade).ToList();

        return new FactoryMarkPerformanceFact
        {
            Scope = scope,
            FactoryId = factoryId,
            FactoryCode = factoryCode,
            MarkId = markId,
            MarkCode = markCode,
            SaleYear = saleYear,
            SaleNo = saleNo,
            TotalProceedsRs = totalProceeds,
            TotalWeightKg = totalWeight,
            AvgPriceRs = totalWeight > 0 ? totalProceeds / totalWeight : 0m,
            GradeMix = gradeMix,
            BestGrades = bestGrades,
            SourceReconciliation = reconciliation,
            ComputedAt = now,
        };
    }

    private async Task UpsertFactAsync(FactoryMarkPerformanceFact fact, CancellationToken ct)
    {
        var filter = Builders<FactoryMarkPerformanceFact>.Filter.Where(f =>
            f.Scope == fact.Scope && f.FactoryId == fact.FactoryId && f.MarkId == fact.MarkId &&
            f.SaleYear == fact.SaleYear && f.SaleNo == fact.SaleNo);
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var existing = await db.FactoryMarkPerformanceFacts.Find(filter).FirstOrDefaultAsync(ct);
        // ObjectId is only auto-generated by the driver on InsertOneAsync/InsertManyAsync, not
        // on an upsert ReplaceOneAsync — left at its default, every new document would get the
        // same all-zero ObjectId.Empty _id, colliding as a duplicate key the moment a second
        // new fact tries to upsert in the same run (confirmed live against real data).
        fact.Id = existing?.Id ?? ObjectId.GenerateNewId();
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        await db.FactoryMarkPerformanceFacts.ReplaceOneAsync(filter, fact, new ReplaceOptions { IsUpsert = true }, ct);
    }

    /// <summary>Builds a (year, saleNo) -> lots index for every /data/sales catalogue whose
    /// year is actually needed by this batch — Catalogue.Year is known from ListCatalogues()
    /// alone, so a catalogue from an irrelevant year is never parsed at all. Within a needed
    /// year, period detection mirrors MarkAscActivityCheckService's own approach (first lot
    /// with a parseable SaleYear/SaleNo stands in for the whole catalogue's period) rather
    /// than depending on SaleFileStore's concrete CatalogueIdFor — this service depends only
    /// on the ICatalogueSource seam, same as its siblings.</summary>
    private Dictionary<(int Year, int SaleNo), IReadOnlyList<Lot>> BuildDataSalesLotsIndex(IReadOnlyList<(int Year, int SaleNo)> periods)
    {
        var neededYears = periods.Select(p => p.Year).ToHashSet();
        var index = new Dictionary<(int, int), IReadOnlyList<Lot>>();
        // TODO: API migration — replace ICatalogueSource/SaleFileStore calls with remote API client once backend migration lands.
        foreach (var cat in catalogues.ListCatalogues().Where(c => neededYears.Contains(c.Year)))
        {
            // TODO: API migration — replace ICatalogueSource/SaleFileStore calls with remote API client once backend migration lands.
            var lots = catalogues.GetLots(cat.Id) ?? [];
            var periodLot = lots.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l.SaleNo) && !string.IsNullOrWhiteSpace(l.SaleYear));
            if (periodLot is null) continue;
            if (int.TryParse(periodLot.SaleYear, out var y) && int.TryParse(periodLot.SaleNo, out var s))
                index.TryAdd((y, s), lots);
        }
        return index;
    }

    private static List<RawLotFact> BuildRawFactsFromDataSales(IReadOnlyList<Lot> lots)
    {
        var (sold, _) = TopPriceEngine.ScopeToSold(lots);
        return sold
            // Reprints (tea re-catalogued after an earlier unsold/withdrawn appearance) are
            // excluded the same way SharedMarkCatalogueService.BuildRows already does for this
            // exact file — without this, a reprinted lot's weight/proceeds would be counted
            // again on top of whichever sale it was first catalogued under.
            .Where(l => !l.IsReprint && !string.IsNullOrWhiteSpace(l.SellingMark) && l.NetWeight is > 0 && l.PurchasedPrice is > 0)
            .Select(l => new RawLotFact(
                l.SellingMark!.Trim().ToUpperInvariant(),
                string.IsNullOrWhiteSpace(l.Grade) ? "(No grade)" : l.Grade!.Trim(),
                l.NetWeight!.Value,
                l.PurchasedPrice!.Value))
            .ToList();
    }

    private async Task<List<RawLotFact>> BuildRawFactsFromArchiveAsync(int saleYear, int saleNo, CancellationToken ct)
    {
        // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
        var lots = await db.AuctionLots.Find(l => l.SaleYear == saleYear && l.SaleNo == saleNo && l.Sold).ToListAsync(ct);
        return lots
            .Where(l => !string.IsNullOrWhiteSpace(l.SellingMark) && l.QuantityKg > 0 && l.PriceRs > 0)
            .Select(l => new RawLotFact(
                l.SellingMark.Trim().ToUpperInvariant(),
                string.IsNullOrWhiteSpace(l.Grade) ? "(No grade)" : l.Grade.Trim(),
                l.QuantityKg,
                l.PriceRs))
            .ToList();
    }
}
