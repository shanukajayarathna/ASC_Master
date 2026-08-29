using Asc.Api.Data;
using Asc.Api.Modules.Msl;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// One-time, re-runnable historical mining job: walks the Msl archive (Modules/Msl's
/// AuctionLot collection — the full 2013–present TXT-derived record, not a Power BI or
/// Excel export) and reconstructs, per mark, exactly which broker(s) sold it in every
/// sale, then derives a smoothed "era" timeline from that.
///
/// The smoothing rule (trailing-window dominant-share) was validated by hand against five
/// full years of real broker-portal data before being ported here: a 100-sale trailing
/// window with a 30% minimum volume share correctly separated genuine one-time broker moves
/// (a mark cleanly switching from one broker to another, with a brief real overlap) from
/// routine week-to-week consignment-splitting that never actually settles (a factory that
/// permanently sends a small slice through a second broker every week, which a naive
/// "broker changed" check would otherwise misreport as constant churn). See the module's
/// design notes for the specific before/after examples this was checked against.
///
/// Idempotent and safe to re-run: every run fully recomputes MarkBrokerPeriodFact and
/// MarkBrokerEra from the current AuctionLot archive rather than patching incrementally, so
/// re-running after new sales land (or after the smoothing threshold is retuned) can't drift
/// from the source data.
/// </summary>
public class MarkIntelligenceMiningService(MongoContext db, MslReferenceService mslReference, ILogger<MarkIntelligenceMiningService> logger)
{
    private const int TrailingWindowSales = 100;
    private const decimal MinShare = 0.30m;

    private record RawFact(int Year, int SaleNo, string MslCode, string Mark, string Broker, decimal Qty);

    /// <summary>A handful of real rows in the archive carry a degenerate MslCode — just the
    /// bare 2-digit region suffix ("00", "09", "37", ...) with no factory prefix, from rows
    /// where the source file's factory field was missing/unparseable. A real MslCode always
    /// starts with a letter (MF/MFA/BF/RT/...), so requiring that excludes the numeric-only
    /// junk without needing to special-case every observed bad value.</summary>
    private static BsonDocument ValidMslCodeCondition() => new("$regex", "^[A-Za-z]");

    public async Task<MiningRunResultDto> RunAsync(CancellationToken ct)
    {
        var facts = await LoadRawFactsAsync(ct);
        logger.LogInformation("Mark intelligence mining: {Count} raw (year,sale,factory,mark,broker) facts loaded from the archive", facts.Count);

        var factoryCodeVariants = await LoadFactoryCodeVariantsAsync(ct);
        var estateNames = await LoadEstateNamesAsync(ct);

        // --- Ensure Plantation rows exist for every distinct group MslReferenceService knows about ---
        var plantationIdByName = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        foreach (var existing in await db.Plantations.Find(FilterDefinition<Plantation>.Empty).ToListAsync(ct))
            plantationIdByName[existing.Name] = existing.Id;

        // --- Ensure a Factory row exists for every distinct MslCode seen ---
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factoriesByCode = (await db.Factories.Find(FilterDefinition<Factory>.Empty).ToListAsync(ct))
            .ToDictionary(f => f.Code, StringComparer.OrdinalIgnoreCase);

        foreach (var mslCode in facts.Select(f => f.MslCode).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (factoriesByCode.ContainsKey(mslCode)) continue;
            var plantationId = ResolvePlantationId(mslCode, factoryCodeVariants, plantationIdByName);
            var factory = new Factory
            {
                Code = mslCode,
                Name = estateNames.GetValueOrDefault(mslCode, mslCode),
                PlantationId = plantationId,
            };
            factoriesByCode[mslCode] = factory;
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Factories.InsertOneAsync(factory, cancellationToken: ct);
        }

        // --- Drop any Plantation that doesn't actually span 2+ factories ---
        // A real plantation company (the ~33 known Regional Plantation Companies + a handful
        // of independent groups — verified directly against ASC's own broker-portal reporting)
        // owns several factories. A "group" of exactly one is just that factory's own name
        // showing up in the source Excel's Producer column, standing in for "no real group" —
        // fabricating a one-factory plantation for every standalone estate produced 372 rows
        // on the real archive, versus the true ~33; this restores that distinction regardless
        // of whether the one-factory case came from this run or an earlier one, so re-running
        // mining after this fix self-heals previously-created bogus plantations too.
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var allFactoriesNow = await db.Factories.Find(FilterDefinition<Factory>.Empty).ToListAsync(ct);
        var factoryCountByPlantation = allFactoriesNow
            .Where(f => f.PlantationId.HasValue)
            .GroupBy(f => f.PlantationId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());
        var singleFactoryPlantationIds = factoryCountByPlantation.Where(kv => kv.Value < 2).Select(kv => kv.Key).ToHashSet();
        if (singleFactoryPlantationIds.Count > 0)
        {
            var affectedFactoryIds = allFactoriesNow.Where(f => f.PlantationId.HasValue && singleFactoryPlantationIds.Contains(f.PlantationId!.Value)).Select(f => f.Id).ToList();
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Factories.UpdateManyAsync(
                Builders<Factory>.Filter.In(f => f.Id, affectedFactoryIds),
                Builders<Factory>.Update.Set(f => f.PlantationId, null).Set(f => f.UpdatedAt, DateTime.UtcNow),
                cancellationToken: ct);
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Plantations.DeleteManyAsync(Builders<Plantation>.Filter.In(p => p.Id, singleFactoryPlantationIds), ct);
            logger.LogInformation("Mark intelligence mining: removed {Count} single-factory \"plantations\" that were really just a standalone estate's own name.", singleFactoryPlantationIds.Count);
        }

        // --- Ensure a Mark row exists for every distinct mark code seen ---
        // Code is a mark's globally unique trading identity (see MarkIntelligenceModels.cs's
        // design note), NOT scoped per factory — the same mark can legitimately appear under
        // more than one MslCode across a multi-year archive (an estate's registration code
        // changing, a factory re-coding, etc.), so grouping must happen by mark code alone.
        // Whichever MslCode carries that mark's most recent activity is treated as its
        // current/canonical factory; a mark that spans more than one factory code is tracked
        // (not silently hidden) via marksThatChangedFactory below.
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var marksByCode = (await db.Marks.Find(FilterDefinition<Mark>.Empty).ToListAsync(ct))
            .ToDictionary(m => m.Code, StringComparer.OrdinalIgnoreCase);

        int newMarksCreated = 0, marksThatChangedFactory = 0;
        var byMarkCode = facts.GroupBy(f => f.Mark, StringComparer.OrdinalIgnoreCase);
        foreach (var markGroup in byMarkCode)
        {
            var markCode = markGroup.Key;
            var mslCodesForThisMark = markGroup.Select(f => f.MslCode).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (mslCodesForThisMark.Count > 1) marksThatChangedFactory++;

            var canonicalMslCode = markGroup
                .GroupBy(f => f.MslCode, StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(g => g.Max(f => f.Year * 100 + f.SaleNo))
                .First().Key;
            var canonicalFactoryId = factoriesByCode[canonicalMslCode].Id;

            if (marksByCode.TryGetValue(markCode, out var existingMark))
            {
                if (existingMark.FactoryId != canonicalFactoryId)
                {
                    existingMark.FactoryId = canonicalFactoryId;
                    // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
                    await db.Marks.UpdateOneAsync(
                        Builders<Mark>.Filter.Eq(m => m.Id, existingMark.Id),
                        Builders<Mark>.Update.Set(m => m.FactoryId, canonicalFactoryId).Set(m => m.UpdatedAt, DateTime.UtcNow),
                        cancellationToken: ct);
                }
                continue;
            }

            var mark = new Mark { FactoryId = canonicalFactoryId, Code = markCode, Name = markCode };
            marksByCode[markCode] = mark;
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Marks.InsertOneAsync(mark, cancellationToken: ct);
            newMarksCreated++;
        }

        // --- Write raw period facts (full replace — cheap to recompute, avoids drift) ---
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.MarkBrokerPeriodFacts.DeleteManyAsync(FilterDefinition<MarkBrokerPeriodFact>.Empty, ct);
        var periodFactDocs = facts.Select(f => new MarkBrokerPeriodFact
        {
            MarkId = marksByCode[f.Mark].Id,
            SaleYear = f.Year,
            SaleNo = f.SaleNo,
            BrokerCode = f.Broker,
            QuantityKg = f.Qty,
        }).ToList();
        if (periodFactDocs.Count > 0)
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.MarkBrokerPeriodFacts.InsertManyAsync(periodFactDocs, cancellationToken: ct);

        // --- Derive smoothed eras per mark ---
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.MarkBrokerEras.DeleteManyAsync(FilterDefinition<MarkBrokerEra>.Empty, ct);

        var marksById = marksByCode.Values.ToDictionary(m => m.Id);
        var factsByMark = periodFactDocs.GroupBy(f => f.MarkId);
        var eraDocs = new List<MarkBrokerEra>();
        int marksWithMultipleEras = 0, marksEverShared = 0;

        foreach (var markGroup in factsByMark)
        {
            var byPeriod = markGroup
                .GroupBy(f => f.SaleYear * 100 + f.SaleNo)
                .OrderBy(g => g.Key)
                .Select(g => (Period: g.Key, ByBroker: g.GroupBy(x => x.BrokerCode).ToDictionary(x => x.Key, x => x.Sum(y => y.QuantityKg))))
                .ToList();

            if (byPeriod.Any(p => p.ByBroker.Count > 1)) marksEverShared++;

            var eras = ComputeEras(byPeriod);
            if (eras.Count > 1) marksWithMultipleEras++;

            foreach (var era in eras)
                eraDocs.Add(new MarkBrokerEra
                {
                    MarkId = markGroup.Key,
                    Brokers = era.Brokers,
                    StartYear = era.StartPeriod / 100,
                    StartSaleNo = era.StartPeriod % 100,
                    EndYear = era.EndPeriod / 100,
                    EndSaleNo = era.EndPeriod % 100,
                });

            // Update the Mark's cached "current brokers" from its latest era.
            var latest = eras.Count > 0 ? eras[^1] : null;
            var mark = marksById[markGroup.Key];
            var newCurrentBrokers = latest?.Brokers ?? [];
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Marks.UpdateOneAsync(
                Builders<Mark>.Filter.Eq(m => m.Id, mark.Id),
                Builders<Mark>.Update.Set(m => m.CurrentBrokers, newCurrentBrokers).Set(m => m.UpdatedAt, DateTime.UtcNow),
                cancellationToken: ct);
        }

        if (eraDocs.Count > 0)
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.MarkBrokerEras.InsertManyAsync(eraDocs, cancellationToken: ct);

        var result = new MiningRunResultDto(
            FactoriesSeen: factoriesByCode.Count,
            MarksSeen: marksByCode.Count,
            NewMarksCreated: newMarksCreated,
            PeriodFactsWritten: periodFactDocs.Count,
            ErasComputed: eraDocs.Count,
            MarksWithMultipleEras: marksWithMultipleEras,
            MarksEverShared: marksEverShared,
            MarksThatChangedFactory: marksThatChangedFactory,
            RunAt: DateTime.UtcNow);

        logger.LogInformation(
            "Mark intelligence mining complete: {Factories} factories, {Marks} marks ({New} new), {Facts} period facts, {Eras} eras " +
            "({Multi} marks with a detected broker change, {Shared} marks ever shared, {Moved} marks spanned more than one factory code).",
            result.FactoriesSeen, result.MarksSeen, result.NewMarksCreated, result.PeriodFactsWritten, result.ErasComputed,
            result.MarksWithMultipleEras, result.MarksEverShared, result.MarksThatChangedFactory);

        return result;
    }

    private record EraResult(List<string> Brokers, int StartPeriod, int EndPeriod);

    private static List<EraResult> ComputeEras(List<(int Period, Dictionary<string, decimal> ByBroker)> byPeriod)
    {
        var series = new List<(int Period, HashSet<string> ActiveSet)>();
        for (var i = 0; i < byPeriod.Count; i++)
        {
            var start = Math.Max(0, i - TrailingWindowSales + 1);
            var totals = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            decimal grandTotal = 0;
            for (var j = start; j <= i; j++)
            {
                foreach (var (broker, qty) in byPeriod[j].ByBroker)
                {
                    totals[broker] = totals.GetValueOrDefault(broker) + qty;
                    grandTotal += qty;
                }
            }
            var activeSet = grandTotal <= 0
                ? []
                : totals.Where(kv => kv.Value / grandTotal >= MinShare).Select(kv => kv.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            series.Add((byPeriod[i].Period, activeSet));
        }

        var eras = new List<EraResult>();
        List<string>? curBrokers = null;
        int curStart = 0, curEnd = 0;
        foreach (var (period, activeSet) in series)
        {
            var sorted = activeSet.OrderBy(x => x).ToList();
            if (curBrokers is null || !sorted.SequenceEqual(curBrokers))
            {
                if (curBrokers is not null) eras.Add(new EraResult(curBrokers, curStart, curEnd));
                curBrokers = sorted;
                curStart = period;
            }
            curEnd = period;
        }
        if (curBrokers is not null) eras.Add(new EraResult(curBrokers, curStart, curEnd));
        return eras;
    }

    /// <summary>Looks up (or creates) the Plantation for the Excel "Producer" value attached
    /// to this factory, with no filtering here — a standalone estate's Producer value is very
    /// often just its own name typed back, which would otherwise look like a real distinct
    /// group at this point. That's deliberately sorted out afterward in RunAsync's post-pass
    /// (a Plantation only "counts" once it's known to span 2+ factories) rather than by
    /// pattern-matching the two name fields here, which — confirmed empirically against the
    /// real local archive — misses the vast majority of self-referential cases: the Producer
    /// text and the factory's own separately-sourced estate name frequently aren't close
    /// enough strings to catch by comparison, even for the exact same physical estate.</summary>
    private Guid? ResolvePlantationId(string mslCode, Dictionary<string, HashSet<string>> factoryCodeVariants, Dictionary<string, Guid> plantationIdByName)
    {
        if (!factoryCodeVariants.TryGetValue(mslCode, out var rawCodes)) return null;
        foreach (var rawCode in rawCodes)
        {
            if (!mslReference.ByFactory.TryGetValue(rawCode, out var reference) || reference.Group is null) continue;
            if (plantationIdByName.TryGetValue(reference.Group, out var id)) return id;
            var plantation = new Plantation { Name = reference.Group };
            plantationIdByName[reference.Group] = plantation.Id;
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            db.Plantations.InsertOne(plantation);
            return plantation.Id;
        }
        return null;
    }

    private async Task<List<RawFact>> LoadRawFactsAsync(CancellationToken ct)
    {
        var raw = db.Database.GetCollection<BsonDocument>("auctionLots");
        var pipeline = new[]
        {
            new BsonDocument("$match", new BsonDocument
            {
                ["mc"] = ValidMslCodeCondition(),
                ["m"] = new BsonDocument("$nin", new BsonArray { BsonNull.Value, "" }),
                ["b"] = new BsonDocument("$nin", new BsonArray { BsonNull.Value, "" }),
            }),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = new BsonDocument { ["y"] = "$y", ["s"] = "$s", ["mc"] = "$mc", ["m"] = "$m", ["b"] = "$b" },
                ["qty"] = new BsonDocument("$sum", "$q"),
            }),
        };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var grouped = await raw.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);

        // Collapse any casing/whitespace variants of the same mark within the same
        // (year, sale, factory, broker) that the DB-level grouping didn't already merge.
        var merged = new Dictionary<(int, int, string, string, string), decimal>();
        foreach (var doc in grouped)
        {
            var id = doc["_id"].AsBsonDocument;
            var year = id["y"].ToInt32();
            var saleNo = id["s"].ToInt32();
            var mslCode = id["mc"].AsString;
            var mark = id["m"].AsString.Trim().ToUpperInvariant();
            var broker = id["b"].AsString;
            var qty = doc["qty"].ToDecimal();
            var key = (year, saleNo, mslCode, mark, broker);
            merged[key] = merged.GetValueOrDefault(key) + qty;
        }

        return merged.Select(kv => new RawFact(kv.Key.Item1, kv.Key.Item2, kv.Key.Item3, kv.Key.Item4, kv.Key.Item5, kv.Value)).ToList();
    }

    /// <summary>Every distinct raw (space-stripped) FactoryCode ever seen under each stable
    /// MslCode — needed because MslReferenceService's plantation-group map is keyed by the
    /// raw factory code, which (unlike MslCode) can vary between brokers for the same
    /// estate, so every variant has to be tried.</summary>
    private async Task<Dictionary<string, HashSet<string>>> LoadFactoryCodeVariantsAsync(CancellationToken ct)
    {
        var raw = db.Database.GetCollection<BsonDocument>("auctionLots");
        var pipeline = new[]
        {
            new BsonDocument("$match", new BsonDocument("mc", ValidMslCodeCondition())),
            new BsonDocument("$group", new BsonDocument { ["_id"] = new BsonDocument { ["mc"] = "$mc", ["f"] = "$f" } }),
        };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var rows = await raw.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        var result = new Dictionary<string, HashSet<string>>();
        foreach (var doc in rows)
        {
            var id = doc["_id"].AsBsonDocument;
            var mslCode = id["mc"].AsString;
            var factoryCode = id.GetValue("f", "").AsString;
            if (string.IsNullOrWhiteSpace(factoryCode)) continue;
            (result.TryGetValue(mslCode, out var set) ? set : result[mslCode] = []).Add(factoryCode.Replace(" ", ""));
        }
        return result;
    }

    /// <summary>One representative estate name per MslCode, for a sensible default Factory
    /// name on first creation (an admin can rename it afterward — this never overwrites an
    /// existing Factory's name).</summary>
    private async Task<Dictionary<string, string>> LoadEstateNamesAsync(CancellationToken ct)
    {
        var raw = db.Database.GetCollection<BsonDocument>("auctionLots");
        var pipeline = new[]
        {
            new BsonDocument("$match", new BsonDocument
            {
                ["mc"] = ValidMslCodeCondition(),
                ["e"] = new BsonDocument("$nin", new BsonArray { BsonNull.Value, "" }),
            }),
            new BsonDocument("$group", new BsonDocument { ["_id"] = "$mc", ["name"] = new BsonDocument("$first", "$e") }),
        };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var rows = await raw.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        return rows.ToDictionary(d => d["_id"].AsString, d => d["name"].AsString.Trim());
    }
}
