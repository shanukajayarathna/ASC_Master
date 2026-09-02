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

/// <summary>ASC's own relationship to a mark — separate from <see cref="MarkStatus"/>,
/// which tracks whether the mark exists at all (any broker). Active/AtRisk/Lost is set by
/// MarkAscActivityCheckService's two scheduled jobs (3-month early warning, 6-month hard
/// cutoff), never by the general mining job.</summary>
public enum AscActivityStatus
{
    /// <summary>ASC sold this mark within the 3-month window.</summary>
    Active,
    /// <summary>No ASC activity in 3 months, but still within 6 — early warning.</summary>
    AtRisk,
    /// <summary>No ASC activity in 6 months — hard cutoff, no longer "our mark."</summary>
    Lost,
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

    /// <summary>Set by MarkAscActivityCheckService's 3-month/6-month jobs — defaults to
    /// Active so a mark with no check run yet (new admin-added mark, or before the jobs
    /// have run for the first time) doesn't read as already lost.</summary>
    [BsonRepresentation(BsonType.String)]
    public AscActivityStatus AscActivityStatus { get; set; } = AscActivityStatus.Active;

    /// <summary>Most recent (year, sale) ASC sold this mark in, reconciled from /data/sales
    /// + the archive per MarkAscActivityCheckService's precedence rule. Null until a check
    /// has run and found at least one ASC fact.</summary>
    public DateTime? LastAscActivityAt { get; set; }

    /// <summary>Set once, the first time a check finds ASC activity for a mark that never
    /// had any before — the "newly incoming for ASC" signal. Never cleared.</summary>
    public DateTime? FirstSeenWithAsc { get; set; }

    public DateTime? AscActivityCheckedAt { get; set; }

    /// <summary>The broker set as of the last ASC-activity check run (CurrentBrokers plus
    /// "AS" folded in/out per that run's own finding, since /data/sales can reveal ASC
    /// activity before the manual mining job's CurrentBrokers catches up) — the baseline
    /// the next run compares against to detect a newly-shared mark.</summary>
    public List<string> LastKnownBrokerSet { get; set; } = [];

    public bool IsCurrentlyOurs => AscActivityStatus != AscActivityStatus.Lost;

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

/// <summary>
/// One durable record of a single mark's ASC-activity evaluation, written every time
/// MarkAscActivityCheckService's 3-month or 6-month job runs — deliberately never
/// overwritten (unlike Mark's own cached fields), so "how has this mark's status changed
/// over time" is a plain indexed query against this collection rather than something a
/// future report has to re-derive. Mirrors how MarkBrokerPeriodFact/MarkBrokerEra sit
/// alongside Mark rather than replacing it.
/// </summary>
[BsonIgnoreExtraElements]
public class MarkActivitySnapshot
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid MarkId { get; set; }

    /// <summary>The job that produced this snapshot — "mark-activity-3mo" or
    /// "mark-activity-6mo" (matches that job's IScheduledReportJob.Key).</summary>
    public string TriggerKey { get; set; } = string.Empty;

    public DateTime RunAt { get; set; }

    [BsonRepresentation(BsonType.String)]
    public AscActivityStatus Status { get; set; }

    public bool IsCurrentlyOurs { get; set; }
    public DateTime? LastAscActivityAt { get; set; }

    /// <summary>True when this run's Status differs from the mark's previously persisted
    /// AscActivityStatus — what a "what changed recently" report filters on.</summary>
    public bool StatusChanged { get; set; }

    /// <summary>The mark's effective broker set as of this run (see Mark.LastKnownBrokerSet).</summary>
    public List<string> BrokerSetAtRun { get; set; } = [];

    /// <summary>True when this run's broker set gained a broker it didn't have before, in
    /// either direction — the durable "this mark just became shared" signal.</summary>
    public bool NewlySharedDetected { get; set; }

    /// <summary>True when this run is the one that set Mark.FirstSeenWithAsc.</summary>
    public bool NewlyIncomingForAsc { get; set; }
}

/// <summary>
/// A SellingMark seen in /data/sales with no matching Mark.Code anywhere yet — a genuinely
/// new mark ASC has started selling that neither the archive (not yet mined) nor an admin
/// (not yet manually added) has turned into a real Mark/Factory record. MarkAscActivityCheckService
/// only evaluates EXISTING marks (see its own doc comment) — it deliberately never fabricates
/// a Factory/Mark from a sale-file row alone, since a real Factory needs a resolved MSL code,
/// which /data/sales' own factory field can't safely provide (see MarkIntelligenceMiningService's
/// design notes on raw-code-to-MslCode resolution). This collection is the surfaced version of
/// that gap: upserted by MarkCode (its natural key) every run a sighting recurs, and marked
/// Resolved once a real Mark with that Code exists (via the next mining run, or an admin
/// manually adding it) — so it never needs its own cleanup job.
/// </summary>
[BsonIgnoreExtraElements]
public class UnresolvedMarkSighting
{
    /// <summary>The normalized (trimmed, upper-invariant) SellingMark value — natural key,
    /// same normalization MarkIntelligenceMiningService uses for Mark.Code.</summary>
    [BsonId]
    public string MarkCode { get; set; } = string.Empty;

    public DateTime FirstSeenAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public int SaleYear { get; set; }
    public int SaleNo { get; set; }
    public int SightingCount { get; set; }

    public bool Resolved { get; set; }
    public DateTime? ResolvedAt { get; set; }
}
