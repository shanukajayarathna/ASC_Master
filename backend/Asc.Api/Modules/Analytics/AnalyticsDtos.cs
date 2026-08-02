namespace Asc.Api.Modules.Analytics;

/// <summary>A superset of Reports' 4-stat valuation analysis (Mean/Median/Highest/Lowest) —
/// computed fresh rather than forced through that smaller DTO, since the shapes genuinely
/// differ enough that reusing it would be awkward, not simplifying.</summary>
public record OverviewStatsDto(
    decimal? Mean,
    decimal? Median,
    decimal? Mode,
    decimal? StdDev,
    decimal? Variance,
    decimal? Q1,
    decimal? Q3,
    decimal? Spread
);

public record TopBottomLotDto(Guid LotId, string? LotNumber, string? Broker, string? Grade, decimal? EffectiveValue);

public record DataQualityDto(int MissingValuations, int IncompleteRecords, int DuplicateLots, int Outliers);

public record BrokerStatsDto(
    string Name,
    int Lots,
    int Valued,
    double Share,
    decimal? Avg,
    decimal? Max,
    decimal? Min,
    string TopGrade,
    string TopCategory,
    decimal NetWeight
);
