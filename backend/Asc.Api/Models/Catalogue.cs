using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Models;

public class Catalogue
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string SourceName { get; set; } = string.Empty;

    /// <summary>Ordered column headers as detected in the uploaded file, preserved for display order.</summary>
    public List<string> Headers { get; set; } = new();

    /// <summary>Per-column metadata (numeric/categorical/options) computed at import time.</summary>
    public Dictionary<string, ColumnMeta> ColumnMeta { get; set; } = new();

    public int RowCount { get; set; }

    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
}

public class ColumnMeta
{
    public bool Numeric { get; set; }
    public bool Categorical { get; set; }
    public List<string> Options { get; set; } = new();
    public bool DefaultVisible { get; set; }
}
