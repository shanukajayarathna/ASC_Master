using Asc.Api.Models;

namespace Asc.Api.DTOs;

public record CatalogueSummaryDto(Guid Id, string SourceName, int RowCount, int ColumnCount, DateTime ImportedAt);

public record CatalogueDetailDto(
    Guid Id,
    string SourceName,
    List<string> Headers,
    Dictionary<string, ColumnMeta> ColumnMeta,
    int RowCount,
    DateTime ImportedAt
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
    string? PrivateNotes
);

public record PagedLotsDto(List<LotDto> Rows, int Total, int Page, int PageSize);

public record BulkClassifyDto(List<Guid> LotIds, string Classification);
public record BulkDeleteNotesDto(List<Guid> LotIds);

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
