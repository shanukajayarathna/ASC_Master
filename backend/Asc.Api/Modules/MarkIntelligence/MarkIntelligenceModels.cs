using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Plantation → Factory → Mark → Broker reference hierarchy, curated/persisted on top of
/// the raw Msl auction archive (Modules/Msl) rather than replacing it — <see cref="Msl.AuctionLot"/>
/// stays the immutable source-of-record for every transaction; this module is the durable,
/// admin-manageable "what do we call this factory/mark, and who currently sells it" layer,
/// plus the mined broker-relationship history derived from the archive.
///
/// Broker identity is deliberately NOT modeled here as its own collection — the real-world
/// set of Colombo tea brokers is small, fixed, and already fully enumerated in
/// <see cref="Msl.MslBrokers"/> (the same MSL file codes AuctionLot.Broker already uses:
/// AS, BTL, DES, EB, FBS, JK, LCB, MB). Reusing that avoids a duplicate, empty-until-populated
/// "Broker" entity for something that essentially never changes.
/// </summary>
[BsonIgnoreExtraElements]
public class Plantation
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The plantation company/group name, e.g. "Kelani Valley Plantations Limited" —
    /// or, for a standalone estate with no parent company, just that estate's own name.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Soft-remove only: a plantation can have factories/marks with real sale history
    /// pointing at it, so deactivating (hiding it from active pickers) is the safe default —
    /// see MarkIntelligenceController.DeletePlantation for when a hard delete is still allowed.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

[BsonIgnoreExtraElements]
public class Factory
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Null when the factory's plantation group is unknown — real for most of the
    /// 13-year MSL archive, since plantation-group data only exists in the recent weekly sale
    /// Excel catalogues (see MslReferenceService), not the archive's own TXT files.</summary>
    [BsonRepresentation(BsonType.String)]
    public Guid? PlantationId { get; set; }

    /// <summary>The MSL code (factory registration + 2-digit region suffix, e.g.
    /// "MF029405") — proven the one stable join key across brokers/years (the raw
    /// factory-code field on AuctionLot disagrees between brokers' own files for the same
    /// estate; MslCode never did, across a full empirical check of a real sale). Globally
    /// unique.</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Display name, e.g. "ROBGILL ESTATE".</summary>
    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public static class MarkStatus
{
    public const string Active = "Active";
    public const string Discontinued = "Discontinued";
}

[BsonIgnoreExtraElements]
public class Mark
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid FactoryId { get; set; }

    /// <summary>The mark's unique trading identity — the normalized selling-mark name itself
    /// (e.g. "ROBGILL", "KALUBOWITIYANA CTC"), not the factory's numeric registration code.
    /// One factory can carry more than one mark (real, observed tier variants like "GREEN
    /// MOUNT" / "GREEN MOUNT SUPER" both selling under the same factory code in the same
    /// week) — the code that's actually unique per mark is this name, uppercased/trimmed.
    /// Globally unique.</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Display name — identical to Code today (there is no separate short code in
    /// the real data, see the module's design note), kept as its own field in case a
    /// distinct display label is ever wanted without touching the trading identity.</summary>
    public string Name { get; set; } = string.Empty;

    public string Status { get; set; } = MarkStatus.Active;

    /// <summary>The most recent smoothed broker era's broker set — [] until the mining job
    /// has run at least once for this mark, or if this mark was just added by an admin with
    /// no sale history yet.</summary>
    public List<string> CurrentBrokers { get; set; } = [];

    public bool IsCurrentlyShared => CurrentBrokers.Count > 1;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// One smoothed "era" of a mark's broker relationship — the human-readable timeline view
/// ("Broker X (2019–2022) → Broker Y (2022–present)"). Derived by MarkIntelligenceMiningService
/// from the raw per-period facts using a trailing-window dominant-share rule (validated
/// against 5 years / ~285k real fact rows: a 100-sale trailing window with a 30% minimum
/// share threshold correctly separated genuine broker moves from routine week-to-week
/// consignment-splitting noise in every hand-checked example). Re-derived wholesale on each
/// mining run rather than incrementally patched — cheap to recompute, avoids drift.
/// </summary>
[BsonIgnoreExtraElements]
public class MarkBrokerEra
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid MarkId { get; set; }

    /// <summary>MSL broker code(s) active this era — more than one means the mark was
    /// durably shared across brokers for this whole era, not just a single overlapping week.</summary>
    public List<string> Brokers { get; set; } = [];

    public int StartYear { get; set; }
    public int StartSaleNo { get; set; }

    /// <summary>Null only for the single most recent era of each mark (still ongoing).</summary>
    public int? EndYear { get; set; }
    public int? EndSaleNo { get; set; }

    public bool IsShared => Brokers.Count > 1;
}

/// <summary>
/// The raw, un-smoothed ground truth: exactly which broker(s) sold a mark in a given sale,
/// and how much — every broker a mark sold through in that period, not collapsed to one.
/// This is what MarkBrokerEra is derived from; kept as its own collection so the smoothing
/// rule can be re-tuned later by recomputing eras from these facts, without re-mining the
/// archive from scratch.
/// </summary>
[BsonIgnoreExtraElements]
public class MarkBrokerPeriodFact
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid MarkId { get; set; }

    public int SaleYear { get; set; }
    public int SaleNo { get; set; }
    public string BrokerCode { get; set; } = string.Empty;
    public decimal QuantityKg { get; set; }
}
