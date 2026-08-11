namespace Asc.Api.Modules.Audit;

public record AuditLogEntryDto(Guid Id, DateTime Timestamp, string? UserEmail, string Action, string? EntityType, string? EntityId, string? Details);
