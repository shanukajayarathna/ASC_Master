using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Models;

public class FilterPreset
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid CatalogueId { get; set; }

    public string Name { get; set; } = string.Empty;
    public Dictionary<string, string> ColumnFilters { get; set; } = new();
    public string? Status { get; set; }
    public string? Search { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ActualPrice
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid CatalogueId { get; set; }

    public string LotNumber { get; set; } = string.Empty;

    /// <summary>Set only when the imported actuals file had a detectable Broker column —
    /// see MarketController.Import. Lot numbers restart per broker within a sale, so without
    /// this a LotNumber alone is ambiguous for nearly every real lot.</summary>
    public string? Broker { get; set; }

    public decimal Price { get; set; }

    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
}

public class SavedReport
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid? CatalogueId { get; set; }

    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Source { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
