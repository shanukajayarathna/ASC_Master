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
    public int? Bags { get; set; }

    /// <summary>The real "Selling Mark" column (estate/factory brand name, e.g. "GREEN RIDGE") —
    /// distinct from Mark above, which resolves to "Trade Mark" (a factory code like "MF0344B")
    /// because its own pattern deliberately excludes "selling". Needed for auction-report
    /// features (top-price ranking, NE/UP region matching) that key off the real estate name.</summary>
    public string? SellingMark { get; set; }

    /// <summary>Raw auction outcome as printed in the sale file (e.g. "Sold", "Outsold",
    /// "Unsold", "Pending") — not the ticket-completion status tracked elsewhere in this app.</summary>
    public string? Status { get; set; }

    /// <summary>The actual auction sale price (Rs./kg), as opposed to Valuation.EffectiveValue
    /// which is ASC's own pre-sale estimate. Populated for every broker's lots, not just ASC's.</summary>
    public decimal? PurchasedPrice { get; set; }

    public string? Buyer { get; set; }
    public string? BuyerName { get; set; }

    /// <summary>The producing factory's short code (e.g. "MF0344") — distinct from Mark/
    /// SellingMark, which name the estate/selling brand, not the factory itself.</summary>
    public string? Factory { get; set; }

    /// <summary>The producing factory's full name (e.g. "MATALE WEST TEA FACTORY").</summary>
    public string? FactoryName { get; set; }

    /// <summary>Full original row, header -> value, for columns not promoted to typed fields.</summary>
    public Dictionary<string, string> RawData { get; set; } = new();

    public Valuation? Valuation { get; set; }
}
