using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Auth;

// Named AppUser, not User: ControllerBase already exposes a `User` property (the request's
// ClaimsPrincipal) — a same-named model type in scope inside a controller would shadow it.
public class AppUser
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public List<string> Roles { get; set; } = [];

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
