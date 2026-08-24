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

    /// <summary>The frontend's whole FilterOptions object (columnFilters, status,
    /// classification, year, search), opaque to the backend — filtering is entirely
    /// client-side already, so this is stored and returned verbatim, never parsed here.</summary>
    public string FiltersJson { get; set; } = string.Empty;

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

    /// <summary>Set only for reports keyed by MSL sale (year, saleNo) rather than by
    /// Catalogue — today just the automated Weekly FACT job (see
    /// Modules/ScheduledReports/WeeklyFactAutoReportJob.cs). Null for every other report
    /// type, which still key off CatalogueId as they always have.</summary>
    public int? SaleYear { get; set; }
    public int? SaleNo { get; set; }

    /// <summary>Set only when this report's actual output was persisted server-side (see
    /// IGeneratedReportFileStore) rather than regenerated on demand from live data — needed
    /// for anything whose inputs are a point-in-time snapshot (e.g. an uploaded CBAC TXT)
    /// that can't be recomputed later the way a Catalogue-backed report can.</summary>
    [BsonRepresentation(BsonType.String)]
    public Guid? StoredFileId { get; set; }

    /// <summary>Free-text note shown alongside the title — today used only by the monthly
    /// Combined Report placeholder job to mark its output as not yet configured. Null for
    /// every hand-generated report.</summary>
    public string? Notes { get; set; }
}
