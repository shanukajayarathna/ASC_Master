using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.AccessRequests;

public enum AccessRequestStatus
{
    Pending,
    Reviewed,
}

/// <summary>A "Request Access" submission from the public landing page. This app is
/// admin-provisioned only (see AuthController.Register) — there's no self-service signup, so
/// this is the queue an Admin works from to create real accounts.</summary>
public class AccessRequest
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Company { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;

    [BsonRepresentation(BsonType.String)]
    public AccessRequestStatus Status { get; set; } = AccessRequestStatus.Pending;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
