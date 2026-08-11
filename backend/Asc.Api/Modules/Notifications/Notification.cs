using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Notifications;

/// <summary>
/// One in-app notification for one recipient. Type is a free string (e.g.
/// "deadline.approaching"), same additive convention as WebhookSubscription.Event and
/// AuditLogEntry.Action — new notification types never need a migration. No email/WhatsApp/
/// push delivery here — this is the in-app record only; see the roadmap's Phase 5 note on
/// external channels needing provider credentials that don't exist yet.
/// </summary>
public class Notification
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; set; }

    public string Type { get; set; } = string.Empty;

    /// <summary>"normal" or "high" — deliberately just two levels, not a numeric scale with
    /// no current consumer for finer grades.</summary>
    public string Priority { get; set; } = "normal";

    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }

    /// <summary>Frontend route to navigate to on click (e.g. "/valuation").</summary>
    public string? ActionUrl { get; set; }

    public string? EntityType { get; set; }
    public string? EntityId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }
}
