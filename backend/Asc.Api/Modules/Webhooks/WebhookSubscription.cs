using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Webhooks;

/// <summary>An external URL (e.g. an n8n webhook trigger) to POST to when a given event
/// happens. Event is a free string, not an enum — the UI currently only offers
/// "catalogue.imported", but nothing here schema-enforces that, so a second event later is
/// additive (a new UI option + a new WebhookSender.SendAsync call site, no model change).</summary>
public class WebhookSubscription
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Url { get; set; } = string.Empty;
    public string Event { get; set; } = string.Empty;

    /// <summary>Used to HMAC-SHA256-sign each delivery (X-ASC-Signature header) so the
    /// receiver can verify a payload genuinely came from this app.</summary>
    public string Secret { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
