using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.MarketPulse;

/// <summary>The five topics a Ceylon tea auction brokerage actually cares about in industry
/// news — deliberately narrow rather than a generic news taxonomy, since the AI scoring
/// prompt is built around exactly these five.</summary>
public enum MarketPulseCategory
{
    TeaMarket,
    ShippingLogistics,
    CurrencyTrade,
    WeatherCrop,
    GlobalEconomy,
}

/// <summary>Pending: ingested but not yet successfully scored (either awaiting the next
/// ingestion tick, or every AI provider failed on it last attempt — both cases retry on the
/// next cycle). Scored: has a real AI relevance score/category. Failed: the AI call
/// succeeded for the batch but this specific item's response couldn't be parsed into a
/// valid score — also retried on the next cycle, kept distinct from Pending only so an
/// admin can tell "never attempted" apart from "attempted and choked on this one."</summary>
public enum MarketPulseItemStatus
{
    Pending,
    Scored,
    Failed,
}

/// <summary>One admin-managed RSS/Atom feed to poll. Category is only a default hint for
/// items this source produces — the AI still assigns each item's real category
/// independently, since one feed (e.g. a general trade-press RSS) can carry stories that
/// span several of the five topics.</summary>
public class MarketPulseSource
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;
    public string FeedUrl { get; set; } = string.Empty;

    [BsonRepresentation(BsonType.String)]
    public MarketPulseCategory Category { get; set; }

    public bool Enabled { get; set; } = true;
    public string? AddedBy { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastFetchedAt { get; set; }
    public bool? LastFetchSucceeded { get; set; }
    public string? LastFetchError { get; set; }
    public int LastFetchNewItems { get; set; }
}

/// <summary>One news item, grounded in its real source: <see cref="RawSummary"/> is the
/// RSS description verbatim, never touched by AI. Everything AI-derived is prefixed
/// <c>Ai*</c> and is nullable — null/unset until (if ever) scoring succeeds, so a caller
/// can always tell "not yet scored" apart from "scored, and this is the real value,"
/// including a relevance score of 0.</summary>
public class MarketPulseItem
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The real article URL — every item links back here. Unique per item; this
    /// is also the sole dedupe key across ingestion cycles.</summary>
    public string SourceUrl { get; set; } = string.Empty;

    public string SourceName { get; set; } = string.Empty;
    public string FeedUrl { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public DateTime? PublishedAt { get; set; }

    /// <summary>Verbatim from the RSS feed's description/summary field — never rewritten,
    /// the raw-material half of "grounded, not generative."</summary>
    public string RawSummary { get; set; } = string.Empty;

    public int? AiRelevanceScore { get; set; }

    [BsonRepresentation(BsonType.String)]
    public MarketPulseCategory? AiCategory { get; set; }

    public string? AiWhyItMatters { get; set; }

    [BsonRepresentation(BsonType.String)]
    public MarketPulseItemStatus Status { get; set; } = MarketPulseItemStatus.Pending;

    public DateTime IngestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ScoredAt { get; set; }
}
