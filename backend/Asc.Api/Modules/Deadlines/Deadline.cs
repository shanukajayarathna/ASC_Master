using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Deadlines;

public enum DeadlineStatus
{
    Pending,
    Reminded,
    Escalated,
    Completed,
    Missed,
}

/// <summary>
/// A tracking row, not a schedule — the one deadline type that exists today (a catalogue's
/// closure) is fully derived from data that already exists (Catalogue.ImportedAt is the
/// auction date; see DeadlineEngine), so this exists purely to remember which escalation
/// level has already been notified for a given entity, not to author a due date. Type is a
/// free string so a future deadline type is additive, not a migration.
/// </summary>
public class Deadline
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Type { get; set; } = string.Empty;

    [BsonRepresentation(BsonType.String)]
    public Guid EntityId { get; set; }

    public string? EntityLabel { get; set; }
    public DateTime DueAt { get; set; }
    public string ResponsibleRole { get; set; } = string.Empty;

    [BsonRepresentation(BsonType.String)]
    public DeadlineStatus Status { get; set; } = DeadlineStatus.Pending;

    /// <summary>0 = never notified; matches EscalationLadder's Level values in DeadlineEngine.</summary>
    public int NotifiedEscalationLevel { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
