namespace Asc.Api.Models;

public enum Classification
{
    Unclassified = 0,
    Best = 1,
    BelowBest = 2,
    Poor = 3,
    // Top tier, above Best. Value 4 (not renumbered) because Mongo stores these as ints —
    // reusing 1-3 would silently re-label every existing classified lot.
    SelectBest = 4
}

/// <summary>The taster's ticket / valuation for one lot — embedded directly in its Lot document.</summary>
public class Valuation
{
    public decimal? ValuationFrom { get; set; }
    public decimal? ValuationTo { get; set; }
    public decimal? ValuationSingle { get; set; }

    public Classification Classification { get; set; } = Classification.Unclassified;

    public string? StandardData { get; set; }
    public string? AdjectiveData { get; set; }
    public string? LiquorRemarks { get; set; }
    public string? MusterReport { get; set; }
    public string? BrokerNotes { get; set; }
    public string? PrivateNotes { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Best-effort single value for aggregation: Single if set, else midpoint of From/To, else From.</summary>
    public decimal? EffectiveValue =>
        ValuationSingle ?? (ValuationFrom.HasValue && ValuationTo.HasValue
            ? (ValuationFrom + ValuationTo) / 2
            : ValuationFrom);

    /// <summary>Field-for-field copy. File-derived valuations live in the shared in-memory
    /// catalogue cache — anything that wants to modify one must clone it first.</summary>
    public Valuation Clone() => (Valuation)MemberwiseClone();
}

/// <summary>
/// A user-entered valuation, stored in the database keyed by the lot's deterministic id.
/// Catalogue data itself is file-backed (see SaleFileStore) — these overrides are the only
/// per-lot state the database holds, and they win over any valuation derived from the
/// sale files when the two are merged.
/// </summary>
public class StoredValuation
{
    [MongoDB.Bson.Serialization.Attributes.BsonId]
    [MongoDB.Bson.Serialization.Attributes.BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid LotId { get; set; }

    [MongoDB.Bson.Serialization.Attributes.BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid CatalogueId { get; set; }

    /// <summary>The lot's stable row key — belt-and-braces identity if ids ever need rebuilding.</summary>
    public string RowKey { get; set; } = string.Empty;

    public Valuation Valuation { get; set; } = new();
}
