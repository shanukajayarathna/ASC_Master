using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Models;

/// <summary>
/// One row from an imported catalogue. Column layouts vary by broker, so the full row
/// is preserved as RawData; commonly-used fields are also extracted into typed
/// properties at import time so they're easy to filter/sort/aggregate on.
/// The Valuation (taster's ticket) is embedded directly since it's always 1:1 with the lot.
/// </summary>
public class Lot
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid CatalogueId { get; set; }

    /// <summary>Stable identity across re-imports: hash of lot number + invoice (mirrors the original client-side rowKeyFor).</summary>
    public string RowKey { get; set; } = string.Empty;

    public string? LotNumber { get; set; }
    public string? Broker { get; set; }
    public string? Grade { get; set; }
    public string? Garden { get; set; }
    public string? Category { get; set; }
    public string? Elevation { get; set; }
    public string? Region { get; set; }
    public string? Warehouse { get; set; }
    public string? Mark { get; set; }
    public string? SaleNo { get; set; }
    public string? SaleYear { get; set; }
    public string? InvoiceNo { get; set; }
    public decimal? NetWeight { get; set; }
    public decimal? GrossWeight { get; set; }

    /// <summary>Full original row, header -> value, for columns not promoted to typed fields.</summary>
    public Dictionary<string, string> RawData { get; set; } = new();

    public Valuation? Valuation { get; set; }
}
