using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.ApiKeys;

/// <summary>A machine credential for external callers (e.g. an n8n workflow) that need to
/// authenticate without a human login. Mirrors AppUser's shape (Roles reuses the exact same
/// Admin/User model — no separate permission system) but hashes with SHA-256, not
/// PasswordHasher's deliberately-slow PBKDF2: the raw key is a 256-bit random value, not a
/// low-entropy human password, so a fast, deterministic hash is the correct — and much
/// cheaper per request — choice here.</summary>
public class ApiKey
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;
    public string KeyHash { get; set; } = string.Empty;

    /// <summary>First 12 characters of the raw key (e.g. "asc_a1b2c3d4") — shown in the UI so
    /// an admin can tell keys apart without the full secret ever being persisted or re-shown.</summary>
    public string KeyPrefix { get; set; } = string.Empty;

    public List<string> Roles { get; set; } = [];

    [BsonRepresentation(BsonType.String)]
    public Guid CreatedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAt { get; set; }
}
