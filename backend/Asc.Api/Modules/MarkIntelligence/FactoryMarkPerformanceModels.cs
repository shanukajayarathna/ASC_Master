using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Pre-aggregated price/grade-mix performance, one document per single sale — the smallest
/// atomic period, matching MarkBrokerPeriodFact's own sale-number bucketing — for either a
/// Mark or (rolled up from its currently-active marks) a Factory. A requested "period" in the
/// service layer is a range of these summed together, not a separate stored granularity.
///
/// Reconciliation mirrors MarkAscActivityCheckService's own precedent: /data/sales (via
/// ICatalogueSource) is authoritative for whichever recent sale periods it actually has a
/// file for — that file is already a consolidated, all-broker General Report, not an
/// ASC-only one — and the Msl auctionLots archive is authoritative for every older period
/// with no /data/sales file on disk. Exactly one source feeds any given document; which one
/// is recorded in SourceReconciliation for auditability, not summed from both.
/// </summary>
public enum FactoryMarkPerformanceScope { Factory, Mark }

public enum FactoryMarkPerformanceSource { DataSales, MslArchive }

[BsonIgnoreExtraElements]
public class FactoryMarkPerformanceFact
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonRepresentation(BsonType.String)]
    public FactoryMarkPerformanceScope Scope { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid FactoryId { get; set; }
    public string FactoryCode { get; set; } = string.Empty;

    /// <summary>Null when Scope == Factory.</summary>
    [BsonRepresentation(BsonType.String)]
    public Guid? MarkId { get; set; }
    public string? MarkCode { get; set; }

    public int SaleYear { get; set; }
    public int SaleNo { get; set; }

    public decimal TotalProceedsRs { get; set; }
    public decimal TotalWeightKg { get; set; }

    /// <summary>TotalProceedsRs / TotalWeightKg — weighted, never an average of per-lot prices.</summary>
    public decimal AvgPriceRs { get; set; }

    public List<GradeMixEntry> GradeMix { get; set; } = [];

    /// <summary>Grade(s) tied for the highest AvgPriceRs among GradeMix entries whose Category
    /// is not Ctc/Off/Dust — mirrors TopPriceEngine.IsTopPriceGrade's own exclusion, so "best
    /// grade" here means the same thing the existing Top Price report already means by it.</summary>
    public List<string> BestGrades { get; set; } = [];

    public FactoryMarkPerformanceSourceReconciliation SourceReconciliation { get; set; } = new();

    public DateTime ComputedAt { get; set; }
}

public class GradeMixEntry
{
    public string Grade { get; set; } = string.Empty;

    /// <summary>Main | PremiumFlowery | Ctc | Off | Dust | Other — see
    /// FactoryMarkPerformanceMiningService.ClassifyGradeCategory.</summary>
    public string Category { get; set; } = string.Empty;

    public decimal WeightKg { get; set; }
    public decimal PctOfTotal { get; set; }

    /// <summary>This grade's own proceeds ÷ this grade's own weight — weighted, same rule as
    /// the document's overall AvgPriceRs.</summary>
    public decimal AvgPriceRs { get; set; }
}

public class FactoryMarkPerformanceSourceReconciliation
{
    [BsonRepresentation(BsonType.String)]
    public FactoryMarkPerformanceSource SourceUsed { get; set; }

    /// <summary>Whether /data/sales had a file for this exact sale period at the time of
    /// mining — false means this document was necessarily sourced from the Msl archive.</summary>
    public bool DataSalesFileAvailable { get; set; }
}

/// <summary>
/// Opportunistic snapshot of a not-yet-auctioned sale's known grade mix (grade + weight only —
/// no price, since the sale hasn't happened) for one Mark, captured the moment someone
/// generates the Shared Mark Catalogued Summary report from raw pre-sale broker uploads (see
/// SharedMarkCatalogueController's new performance-snapshot call). Keyed by MarkCode (the
/// normalized Selling Mark text, matching Mark.Code) rather than a factory code — the raw
/// upload files' own Factory/Trade-Mark code scheme doesn't match Factory.Code's MslCode
/// scheme, but Selling Mark text is exactly what MarkIntelligenceMiningService already
/// normalizes into Mark.Code from the very same archive, so joining on it needs no new
/// cross-scheme resolution. There is no guarantee of exactly 3 upcoming sales having a
/// snapshot — whichever sales someone has actually uploaded pre-sale catalogues for, 0 to 3,
/// is what the forward estimate reads opportunistically.
/// </summary>
[BsonIgnoreExtraElements]
public class PreSaleCatalogueFact
{
    [BsonId]
    public ObjectId Id { get; set; }

    public string MarkCode { get; set; } = string.Empty;
    public int SaleYear { get; set; }
    public int SaleNo { get; set; }

    public List<GradeWeightEntry> GradeMix { get; set; } = [];

    public DateTime UploadedAt { get; set; }
}

public class GradeWeightEntry
{
    public string Grade { get; set; } = string.Empty;
    public decimal WeightKg { get; set; }
}
