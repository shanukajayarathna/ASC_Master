using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarketPulse;

public record MarketPulseIngestionSummary(
    int SourcesChecked, int SourcesFailed, int NewItems, int Scored, int StillUnscored);

/// <summary>Shared, singleton lock so a manual <c>POST /refresh</c> (from a request-scoped
/// controller instance) and the scheduled tick (from its own fresh scope — see
/// <see cref="MarketPulseIngestionService"/>) can never run concurrently and double-score
/// the same batch. Has to live outside <see cref="MarketPulseIngestionEngine"/> itself
/// because the engine is scoped (it depends on the scoped <c>AiGateway</c>), so a new
/// engine instance — and a new semaphore, if it owned one — is created per scope; only a
/// singleton is actually shared across all of them.</summary>
public class MarketPulseIngestionGate
{
    public SemaphoreSlim Semaphore { get; } = new(1, 1);
}

/// <summary>
/// The actual "pull every enabled feed, dedupe, score, store" logic — split out from
/// <see cref="MarketPulseIngestionService"/> (the scheduled loop) the same way
/// <c>DeadlineEngine</c> is split from <c>DeadlineCheckService</c>, so the manual
/// <c>POST /refresh</c> endpoint can call this directly without going through a
/// BackgroundService. Registered scoped, not singleton, because it depends (via
/// <see cref="MarketPulseScoringService"/>) on <c>AiGateway</c>, which is itself scoped —
/// see <see cref="MarketPulseIngestionService"/>'s doc comment for how the background loop
/// gets a fresh scope each tick to satisfy that.
/// </summary>
public class MarketPulseIngestionEngine(
    MongoContext db,
    IMarketPulseFeedFetcher fetcher,
    MarketPulseScoringService scorer,
    MarketPulseIngestionGate gate,
    IConfiguration config,
    ILogger<MarketPulseIngestionEngine> logger)
{

    /// <summary>Items scoring below this are still stored (with their real score, so the
    /// URL stays deduped and is never re-sent to the AI) but excluded from the default
    /// feed query — see MarketPulseController's GET endpoint. Configurable via
    /// MarketPulse:RelevanceThreshold; defaults to the 40 the feature spec asked for.</summary>
    public int RelevanceThreshold => int.TryParse(config["MarketPulse:RelevanceThreshold"], out var t) ? t : 40;

    /// <summary>Caps one cycle's single AI call so a newly-added, unusually large feed
    /// can't blow the whole cycle's token budget in one request.</summary>
    private int ScoringBatchLimit => int.TryParse(config["MarketPulse:ScoringBatchLimit"], out var l) ? l : 60;

    public async Task<MarketPulseIngestionSummary> RunOnceAsync(CancellationToken ct)
    {
        await gate.Semaphore.WaitAsync(ct);
        try
        {
            var sources = await db.MarketPulseSources.Find(s => s.Enabled).ToListAsync(ct);
            int sourcesFailed = 0, newItems = 0;

            foreach (var source in sources)
            {
                List<MarketPulseFeedItem> fetched;
                try
                {
                    fetched = await fetcher.FetchAsync(source.FeedUrl, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    sourcesFailed++;
                    logger.LogWarning(ex, "Market Pulse: fetch failed for source {Name} ({Url})", source.Name, source.FeedUrl);
                    await db.MarketPulseSources.UpdateOneAsync(s => s.Id == source.Id,
                        Builders<MarketPulseSource>.Update
                            .Set(s => s.LastFetchedAt, DateTime.UtcNow)
                            .Set(s => s.LastFetchSucceeded, false)
                            .Set(s => s.LastFetchError, ex.Message)
                            .Set(s => s.LastFetchNewItems, 0),
                        cancellationToken: ct);
                    continue;
                }

                // Dedupe by URL first, before anything else touches these items — the
                // module's cost-discipline principle: an AI call is only ever spent on an
                // item we haven't already seen.
                var urls = fetched.Select(f => f.Url).ToList();
                var existingUrls = (await db.MarketPulseItems
                    .Find(Builders<MarketPulseItem>.Filter.In(i => i.SourceUrl, urls))
                    .Project(i => i.SourceUrl)
                    .ToListAsync(ct)).ToHashSet();
                var freshItems = fetched.Where(f => !existingUrls.Contains(f.Url)).ToList();

                if (freshItems.Count > 0)
                {
                    await db.MarketPulseItems.InsertManyAsync(freshItems.Select(f => new MarketPulseItem
                    {
                        SourceUrl = f.Url,
                        SourceName = source.Name,
                        FeedUrl = source.FeedUrl,
                        Title = f.Title,
                        PublishedAt = f.PublishedAt,
                        RawSummary = f.Summary,
                        Status = MarketPulseItemStatus.Pending,
                    }), cancellationToken: ct);
                    newItems += freshItems.Count;
                }

                await db.MarketPulseSources.UpdateOneAsync(s => s.Id == source.Id,
                    Builders<MarketPulseSource>.Update
                        .Set(s => s.LastFetchedAt, DateTime.UtcNow)
                        .Set(s => s.LastFetchSucceeded, true)
                        .Set(s => s.LastFetchError, (string?)null)
                        .Set(s => s.LastFetchNewItems, freshItems.Count),
                    cancellationToken: ct);
            }

            var scoredCount = await ScorePendingAsync(ct);

            var stillUnscored = await db.MarketPulseItems.CountDocumentsAsync(
                i => i.Status == MarketPulseItemStatus.Pending || i.Status == MarketPulseItemStatus.Failed, cancellationToken: ct);

            return new MarketPulseIngestionSummary(sources.Count, sourcesFailed, newItems, scoredCount, (int)stillUnscored);
        }
        finally
        {
            gate.Semaphore.Release();
        }
    }

    /// <summary>One AI call per ingestion cycle covering every unscored item (this cycle's
    /// new ones, plus any carried over from a cycle where every provider failed) — never
    /// one call per article. An item the AI batch doesn't come back with a result for
    /// simply stays retriable (Failed if the batch otherwise succeeded, left Pending if the
    /// whole call failed) rather than being lost.</summary>
    private async Task<int> ScorePendingAsync(CancellationToken ct)
    {
        var toScore = await db.MarketPulseItems
            .Find(i => i.Status != MarketPulseItemStatus.Scored)
            .SortBy(i => i.IngestedAt)
            .Limit(ScoringBatchLimit)
            .ToListAsync(ct);
        if (toScore.Count == 0) return 0;

        var inputs = toScore.Select((item, idx) => new MarketPulseScoringInput(idx, item.Title, item.RawSummary)).ToList();
        var results = (await scorer.ScoreBatchAsync(inputs, ct)).ToDictionary(r => r.Index);

        var scoredCount = 0;
        for (var idx = 0; idx < toScore.Count; idx++)
        {
            var item = toScore[idx];
            if (!results.TryGetValue(idx, out var result))
            {
                // Whole batch failed (results.Count == 0 for every item): leave Pending,
                // retried wholesale next cycle. Batch succeeded but this one result is
                // missing/unparseable: mark Failed — same retry treatment, just a distinct
                // status so an admin can tell the two situations apart.
                if (results.Count > 0)
                    await db.MarketPulseItems.UpdateOneAsync(i => i.Id == item.Id,
                        Builders<MarketPulseItem>.Update.Set(i => i.Status, MarketPulseItemStatus.Failed), cancellationToken: ct);
                continue;
            }

            await db.MarketPulseItems.UpdateOneAsync(i => i.Id == item.Id,
                Builders<MarketPulseItem>.Update
                    .Set(i => i.AiRelevanceScore, result.RelevanceScore)
                    .Set(i => i.AiCategory, result.Category)
                    .Set(i => i.AiWhyItMatters, result.WhyItMatters)
                    .Set(i => i.Status, MarketPulseItemStatus.Scored)
                    .Set(i => i.ScoredAt, DateTime.UtcNow),
                cancellationToken: ct);
            scoredCount++;
        }
        return scoredCount;
    }
}
