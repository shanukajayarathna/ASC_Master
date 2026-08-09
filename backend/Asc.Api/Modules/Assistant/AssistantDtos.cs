namespace Asc.Api.Modules.Assistant;

public record ChatRequestDto(Guid? ConversationId, string Message, string? Provider = null);

public record ChatResponseDto(Guid ConversationId, string Reply, string Provider);

public record ConversationDto(Guid Id, string Title, DateTime CreatedAt);

public record MessageDto(Guid Id, string Role, string Content, DateTime CreatedAt, string? Provider);

public record CompareRequestDto(string Message, List<string>? Providers = null);

public record CompareResultDto(string Provider, bool Success, string? Reply, long DurationMs, string? Error);
