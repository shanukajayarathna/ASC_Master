namespace Asc.Api.Modules.Deadlines;

public record DeadlineDto(
    Guid Id, string Type, Guid EntityId, string? EntityLabel, DateTime DueAt,
    string ResponsibleRole, string Status, int NotifiedEscalationLevel);
