namespace Asc.Api.Modules.MarketBulletin;

/// <summary>A price-tier's range for one sale. LotCount 0 (Min/Max null) renders as "NA" —
/// too few (or zero) lots in that tier/band for this sale. QuantityPct is this tier's share of
/// the grade's total traded quantity (Kg) for that same week — e.g. Select Best at 22% means
/// this week's Select Best lots carried 22% of this grade's total Kg this week. Null when the
/// grade traded zero quantity that week (nothing to take a share of), never 0 in that case, so
/// "no trade" isn't confused with "traded, but this tier got none."</summary>
public record PriceRangeDto(decimal? Min, decimal? Max, int LotCount, decimal? QuantityPct);

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
/// traded quantity (kg) across every sold lot that landed in it; MinPrice/MaxPrice are the
/// literal lowest/highest price among ASC's own lots in that tier, shown as a range rather than
/// a single quantity-weighted average per the user's own instruction — a range says something a
/// single number can't (how wide the tier's own real spread was that sale), the same reasoning
/// pages 1-3's Select Best/Best/Below Best/Poor rows already show a min-max range instead of one
/// number. All three null when the tier had zero priced lots.</summary>
public record MonthlyTierMetricsDto(string Tier, decimal? QuantityKg, decimal? MinPrice, decimal? MaxPrice, int LotCount);

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
