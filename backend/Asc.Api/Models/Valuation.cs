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
}
