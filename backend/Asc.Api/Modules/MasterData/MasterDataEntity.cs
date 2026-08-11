using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.MasterData;

/// <summary>
/// A canonical business entity (a specific broker, buyer, garden, grade, ...) plus every raw
/// spelling variant seen in broker files that should resolve to it — e.g. CanonicalName
/// "ABC Ltd" with Aliases ["A.B.C. Ltd", "ABC LIMITED"]. One generic model covers all nine
/// MasterDataEntityType values instead of nine near-identical tables. Matching against
/// Aliases (and CanonicalName itself) is case/whitespace-insensitive — see
/// MasterDataNormalizer — so an alias doesn't need to be typed to match exactly.
/// Resolution is read-time only (MasterDataResolver); Lot and the file-backed catalogue
/// store never reference this collection or store a canonical id.
/// </summary>
public class MasterDataEntity
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public MasterDataEntityType Type { get; set; }

    public string CanonicalName { get; set; } = string.Empty;

    public List<string> Aliases { get; set; } = [];

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
