using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.LearningContent;

/// <summary>The three content types the Knowledge Base's "Learn" carousel groups tiles
/// into — module usage guidance, general tea-industry education, and longer-form written
/// articles. Deliberately narrow, matching MarketPulseCategory's own "built around exactly
/// these" rationale rather than an open-ended taxonomy.</summary>
public enum LearningContentCategory
{
    ModuleGuidance,
    TeaEducation,
    Article,
}

/// <summary>One admin-managed Knowledge Base learning tile. <see cref="VideoUrl"/> is
/// nullable by design — null means "walkthrough coming soon" (no video asset exists yet),
/// not an error; the tile still renders with its image/tagline/body, and the video panel
/// swaps in automatically the moment an admin sets a real URL, no code change needed.</summary>
public class LearningContentItem
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public LearningContentCategory Category { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Tagline { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string? VideoUrl { get; set; }

    public int Order { get; set; }
    public bool IsPublished { get; set; } = true;

    public string? AddedBy { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}
