using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.LandingContent;

/// <summary>Single-document CMS content for the public marketing page (/home) — everything an
/// Admin can edit without a deploy. One row lives in the collection; <see cref="LandingPageContentController"/>
/// upserts it in place rather than versioning history.</summary>
// [BsonIgnoreExtraElements] on every class here: this schema is still evolving during
// development (CompanyStatsContent already changed shape once — see its doc comment), and
// the Mongo driver's default class-map serializer throws on any stored field it doesn't
// recognize rather than ignoring it, which would otherwise crash the app at startup the next
// time a field is renamed/removed instead of just dropping the stale data harmlessly.
[BsonIgnoreExtraElements]
public class LandingPageContent
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public HeroContent Hero { get; set; } = new();
    public CompanyStatsContent CompanyStats { get; set; } = new();
    public List<PlatformStat> PlatformStats { get; set; } = [];
    public List<IntelligenceItem> FiveIntelligences { get; set; } = [];
    public List<Testimonial> Testimonials { get; set; } = [];
    public HeritageContent Heritage { get; set; } = new();

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? UpdatedBy { get; set; }
}

[BsonIgnoreExtraElements]
public class HeroContent
{
    public string Headline { get; set; } = string.Empty;
    public string Subhead { get; set; } = string.Empty;
    public string CtaPrimaryLabel { get; set; } = string.Empty;
    public string CtaSecondaryLabel { get; set; } = string.Empty;
}

/// <summary>Real, sourced Asia Siyaka Commodities facts (not invented placeholders — see
/// LandingPageContentSeed) — deliberately shaped around what the company actually publishes
/// (a market-share/ranking claim, not a fabricated volume-in-kg figure) rather than the
/// generic "avg annual volume" field an earlier draft of this schema guessed at.</summary>
[BsonIgnoreExtraElements]
public class CompanyStatsContent
{
    public int FoundedYear { get; set; }
    public int YearsOperating { get; set; }

    /// <summary>e.g. "Top 4 tea broker in Sri Lanka".</summary>
    public string Ranking { get; set; } = string.Empty;

    /// <summary>e.g. "~15% of Sri Lanka's total traded tea volume over 25 years".</summary>
    public string MarketShareLabel { get; set; } = string.Empty;

    public int EmployeeCount { get; set; }
    public int WarehouseCount { get; set; }

    public string Vision { get; set; } = string.Empty;
    public string Mission { get; set; } = string.Empty;
}

/// <summary>One "live metrics strip" tile. <see cref="Value"/> is the Admin-entered display
/// value; when <see cref="IsLive"/> is set, <see cref="LandingPageContentController"/> overrides
/// it at read time with a real count from the platform (keyed by <see cref="LiveSourceKey"/>) —
/// the Admin-entered value becomes a fallback shown only if the live lookup fails.</summary>
[BsonIgnoreExtraElements]
public class PlatformStat
{
    public string Label { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public bool IsLive { get; set; }
    public string? LiveSourceKey { get; set; }
}

[BsonIgnoreExtraElements]
public class IntelligenceItem
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public int Order { get; set; }
}

[BsonIgnoreExtraElements]
public class Testimonial
{
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Quote { get; set; } = string.Empty;
    public string AvatarUrl { get; set; } = string.Empty;
    public int Order { get; set; }

    /// <summary>Drafts don't go live immediately — the public GET filters to published only.</summary>
    public bool IsPublished { get; set; } = true;
}

[BsonIgnoreExtraElements]
public class HeritageContent
{
    public string PullQuote { get; set; } = string.Empty;
    public string BodyCopy { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
}
