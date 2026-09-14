namespace Asc.Api.Modules.MarkIntelligence;

public record GradeMixEntryDto(string Grade, string Category, decimal WeightKg, decimal PctOfTotal, decimal AvgPriceRs);

/// <summary>One factory's or mark's historical performance over a requested sale-number
/// range — built by summing however many per-sale FactoryMarkPerformanceFact documents fall
/// in that range (SalesIncluded), never computed live from raw lots.</summary>
public record FactoryMarkPerformanceSummaryDto(
    string Scope, // "Factory" | "Mark"
    string FactoryCode,
    string? MarkCode,
    int FromYear, int FromSaleNo, int ToYear, int ToSaleNo,
    decimal TotalProceedsRs, decimal TotalWeightKg, decimal AvgPriceRs,
    List<GradeMixEntryDto> GradeMix,
    List<string> BestGrades,
    int SalesIncluded);

public record ForwardEstimateSaleDto(int SaleYear, int SaleNo);

public record ForwardEstimateGradeDto(
    string Grade, decimal EstimatedWeightKg, decimal TrailingAvgPriceRs, decimal EstimatedValueRs,
    decimal ContributionPct, bool UsedFactoryWideFallback, bool HasTrailingPriceData);

/// <summary>Arithmetic only — no forecasting model. EstimatedWeightKg per grade comes from
/// whichever upcoming sales (0-3) actually have an uploaded pre-sale catalogue snapshot;
/// TrailingAvgPriceRs comes from the last few already-mined sales for the same factory/mark
/// (falling back to the factory-wide trailing average when a mark has no recent history for
/// that particular grade).</summary>
public record ForwardEstimateSummaryDto(
    string Scope, string FactoryCode, string? MarkCode,
    List<ForwardEstimateSaleDto> UpcomingSalesIncluded,
    decimal EstimatedTotalProceedsRs, decimal EstimatedTotalWeightKg, decimal EstimatedAvgPriceRs,
    List<ForwardEstimateGradeDto> GradeBreakdown);

public record BackfillResultDto(int PeriodsFound, int PeriodsMined, int MarkFactsWritten, int FactoryFactsWritten);

/// <summary>Backs the Comparison tab's factory picker — mirrors MarkIntelligenceController.
/// Search's own by-code-or-name regex approach, scoped to Factory instead of Mark (that
/// controller only searches marks; picking a factory to compare needs its own lookup).</summary>
public record FactorySearchResultDto(string Code, string Name);
