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
