namespace Asc.Api.Modules.Notifications;

public record NotificationDto(
    Guid Id, string Type, string Priority, string Title, string? Body, string? ActionUrl,
    string? EntityType, string? EntityId, DateTime CreatedAt, DateTime? ReadAt);
