using Asc.Api.Models;

namespace Asc.Api.DTOs;

public record CatalogueSummaryDto(
    Guid Id,
    string SourceName,
    int RowCount,
    int ColumnCount,
    DateTime ImportedAt,
    int Year,
    DateTime? SaleDateStart = null,
    DateTime? SaleDateEnd = null,
    List<string>? Headers = null
);

public record CatalogueDetailDto(
    Guid Id,
    string SourceName,
    List<string> Headers,
    Dictionary<string, ColumnMeta> ColumnMeta,
    int RowCount,
    DateTime ImportedAt,
    int Year,
    DateTime? SaleDateStart = null,
    DateTime? SaleDateEnd = null
);

public record LotDto(
    Guid Id,
    string RowKey,
    string? LotNumber,
    string? Broker,
    string? Grade,
    string? Garden,
    string? Category,
    string? Elevation,
    string? Region,
    string? Warehouse,
    string? Mark,
    string? SaleNo,
    string? SaleYear,
    string? InvoiceNo,
    decimal? NetWeight,
    decimal? GrossWeight,
    Dictionary<string, string> RawData,
    ValuationDto? Valuation
);

public record ValuationDto(
    decimal? ValuationFrom,
    decimal? ValuationTo,
    decimal? ValuationSingle,
    string Classification,
    string? StandardData,
    string? AdjectiveData,
    string? LiquorRemarks,
    string? MusterReport,
    string? BrokerNotes,
    string? PrivateNotes,
    DateTime? UpdatedAt
);

public record ValuationUpdateDto(
    decimal? ValuationFrom,
    decimal? ValuationTo,
    decimal? ValuationSingle,
    string? Classification,
    string? StandardData,
    string? AdjectiveData,
    string? LiquorRemarks,
    string? MusterReport,
    string? BrokerNotes,
    string? PrivateNotes,
    /// <summary>The UpdatedAt the client last saw for this lot (null if it had never been
    /// valued) — echoed back from ValuationDto.UpdatedAt. A mismatch means someone else
    /// saved a change in between, so the request is rejected instead of overwriting it.</summary>
    DateTime? ExpectedUpdatedAt = null
);

/// <summary>409 body for a valuation save that lost the race — carries the lot as it
/// actually stands now, so a client can show it without a separate re-fetch.</summary>
public record ValuationConflictDto(string Message, LotDto Lot);

/// <summary>Progress of a sale being loaded live from OKLO: how much of the sale has arrived so far.
/// <paramref name="Unchanged"/> answers a "knownVersion" poll: the sale hasn't been refreshed since the client last read it.</summary>
public record LiveLoadDto(int SaleTotal, int Loaded, bool Complete, DateTime? FetchedAtUtc, bool Refreshing, string? Error, bool Unchanged = false);

/// <summary>The distinct values of the requested columns of a sale, for the filter dropdowns. While a live sale is
/// still arriving they cover what has loaded so far (<paramref name="Live"/>.Complete = false).</summary>
public record FilterOptionsDto(Dictionary<string, List<string>> Options, int SaleTotal, LiveLoadDto? Live);

/// <summary>A page of lots. <paramref name="Live"/> is set when the sale is served live from OKLO and
/// tells the client whether more rows are still arriving (Complete = false).</summary>
public record PagedLotsDto(List<LotDto> Rows, int Total, int Page, int PageSize, LiveLoadDto? Live = null);

public record BulkClassifyDto(List<Guid> LotIds, string Classification);
public record BulkDeleteNotesDto(List<Guid> LotIds);

/// <summary>One classification tier's track record for a grade in a previous sale.</summary>
public record GradeTierStatsDto(string Classification, int Count, double Percent, decimal Min, decimal Max, decimal Avg);

/// <summary>How one grade was classified in the most recent previous sale that offered it.</summary>
public record GradeStatsDto(string SaleName, int Total, List<GradeTierStatsDto> Tiers);

public record PreviousGradeStatsDto(Dictionary<string, GradeStatsDto> Grades);

public record DashboardStatsDto(
    int Total,
    int Completed,
    int Pending,
    int TodayCount,
    decimal? AvgValuation,
    decimal? MaxValuation,
    decimal? MinValuation,
    decimal? AvgRangeWidth,
    string? MostActiveBroker,
    string? MostCommonGrade,
    string? MostCommonCategory,
    string? MostCommonElevation,
    decimal? TotalNetWeight,
    decimal? TotalGrossWeight,
    decimal? AvgNetWeight,
    decimal? AvgGrossWeight
);
