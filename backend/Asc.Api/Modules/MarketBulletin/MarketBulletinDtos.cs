namespace Asc.Api.Modules.MarketBulletin;

/// <summary>A price-tier's range for one sale. LotCount 0 (Min/Max null) renders as "NA" —
/// too few (or zero) lots in that tier/band for this sale.</summary>
public record PriceRangeDto(decimal? Min, decimal? Max, int LotCount);

public record BulletinRowDto(string Label, PriceRangeDto ThisWeek, PriceRangeDto LastWeek);

public record BulletinTableDto(string GradeLabel, List<BulletinRowDto> Rows);

public record BulletinSectionDto(string Title, List<BulletinTableDto> Tables);

public record MarketBulletinDto(
    string SourceName,
    string? PreviousSourceName,
    DateTime GeneratedAt,
    List<BulletinSectionDto> Sections);
