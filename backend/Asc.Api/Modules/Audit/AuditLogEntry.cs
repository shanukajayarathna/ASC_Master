using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Audit;

/// <summary>
/// One "who did what" record. Action is a free string (e.g. "user.role_changed",
/// "api_key.created") rather than an enum, mirroring WebhookSubscription's own Event field —
/// new action types stay additive, never a migration. Details is a short human-readable
/// summary only; callers must never put secrets (raw API keys, webhook signing secrets,
/// passwords) in it.
/// </summary>
public class AuditLogEntry
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    [BsonRepresentation(BsonType.String)]
    public Guid? UserId { get; set; }

    public string? UserEmail { get; set; }

    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string? Details { get; set; }
}
