namespace Asc.Api.Modules.Assistant;

public record ChatRequestDto(Guid? ConversationId, string Message);

public record ChatResponseDto(Guid ConversationId, string Reply);

public record ConversationDto(Guid Id, string Title, DateTime CreatedAt);

public record MessageDto(Guid Id, string Role, string Content, DateTime CreatedAt);
