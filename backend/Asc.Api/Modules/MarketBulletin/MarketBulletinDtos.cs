namespace Asc.Api.Modules.MarketBulletin;

/// <summary>A price-tier's range for one sale. LotCount 0 (Min/Max null) renders as "NA" —
/// too few (or zero) lots in that tier/band for this sale.</summary>
public record PriceRangeDto(decimal? Min, decimal? Max, int LotCount);

public record BulletinRowDto(string Label, PriceRangeDto ThisWeek, PriceRangeDto LastWeek);

/// <summary>GroupLabel is null for a section whose tables are all one flat list (e.g. High and
/// Medium — same 15 grades as Low Grown, same order, but shown as one continuous list with no
/// sub-headers per the user's own instruction). When set (Low Grown's "Leafy"/"Semi Leafy"/
/// "Tippy"), the frontend renders a sub-header whenever it changes from the previous table in
/// the section, letting one section visually group its own tables without needing three
/// separate top-level sections for what's really one category.</summary>
public record BulletinTableDto(string GradeLabel, List<BulletinRowDto> Rows, string? GroupLabel = null);

public record BulletinSectionDto(string Title, List<BulletinTableDto> Tables);

public record MarketBulletinDto(
    string SourceName,
    string? PreviousSourceName,
    DateTime GeneratedAt,
    List<BulletinSectionDto> Sections);

/// <summary>One tier's whole-sale metrics for one sale slot — QuantityKg is that tier's total
/// traded quantity (kg) across every sold lot that landed in it; AveragePrice is the
/// QUANTITY-WEIGHTED average price (sum(price*qty)/sum(qty), not a plain per-lot average) —
/// the standard way to average an auction price so a handful of large lots aren't swamped by
/// many small ones or vice versa. Both null when the tier had zero priced lots.</summary>
public record MonthlyTierMetricsDto(string Tier, decimal? QuantityKg, decimal? AveragePrice, int LotCount);

/// <summary>One "slot" in a month's calendar — Position is 1-based ordinal within the month
/// (1st sale of the month, 2nd, ...), independent of the actual SaleNo (which resets per
/// year, not per month). Tiers is null when this slot's sale hasn't happened yet (no
/// catalogue on file for that sale number) — the caller renders that as an empty placeholder,
/// never as zero, so "no data yet" is never confused with "traded nothing."</summary>
public record MonthlySaleSlotDto(int Position, string? SourceName, List<MonthlyTierMetricsDto>? Tiers);

public record MonthlyComparisonDto(
    string ThisMonthLabel,
    string LastMonthLabel,
    List<MonthlySaleSlotDto> ThisMonth,
    List<MonthlySaleSlotDto> LastMonth);
