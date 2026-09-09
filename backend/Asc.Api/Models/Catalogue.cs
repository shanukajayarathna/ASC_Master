using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Models;

public class Catalogue
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string SourceName { get; set; } = string.Empty;

    /// <summary>Calendar year this sale belongs to. 2026 sales are the legacy flat-root
    /// namespace (data/sales/*.xlsx); any other year lives under data/sales/{year}/.</summary>
    public int Year { get; set; }

    /// <summary>Ordered column headers as detected in the uploaded file, preserved for display order.</summary>
    public List<string> Headers { get; set; } = new();

    /// <summary>Per-column metadata (numeric/categorical/options) computed at import time.</summary>
    public Dictionary<string, ColumnMeta> ColumnMeta { get; set; } = new();

    public int RowCount { get; set; }

    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;

    /// <summary>The real auction date(s), read directly from this sale's own "Selling End Time"
    /// column (min/max across every lot) rather than assumed from a hand-maintained weekly
    /// calendar (see SaleFileStore.SaleDateFor, which ImportedAt above still uses) — a sale that
    /// genuinely runs across two calendar days (SaleDateEnd's date differs from SaleDateStart's)
    /// should show as a range, not silently collapse to one. Null when the column is missing or
    /// unparseable for every row in this file.</summary>
    public DateTime? SaleDateStart { get; set; }

    public DateTime? SaleDateEnd { get; set; }
}

public class ColumnMeta
{
    public bool Numeric { get; set; }
    public bool Categorical { get; set; }
    public List<string> Options { get; set; } = new();
    public bool DefaultVisible { get; set; }
}
