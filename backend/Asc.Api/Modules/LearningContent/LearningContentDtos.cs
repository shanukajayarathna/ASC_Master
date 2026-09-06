namespace Asc.Api.Modules.LearningContent;

public record LearningContentItemDto(
    Guid Id, string Category, string Title, string Tagline, string Body, string ImageUrl,
    string? VideoUrl, int Order, bool IsPublished, string? AddedBy, DateTime AddedAt);

public record CreateLearningContentDto(
    string Category, string Title, string Tagline, string Body, string ImageUrl,
    string? VideoUrl, int Order = 0, bool IsPublished = true);

public record UpdateLearningContentDto(
    string? Category, string? Title, string? Tagline, string? Body, string? ImageUrl,
    string? VideoUrl, int? Order, bool? IsPublished);
