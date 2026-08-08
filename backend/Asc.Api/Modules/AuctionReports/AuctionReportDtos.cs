namespace Asc.Api.Modules.AuctionReports;

/// <summary>One ranked row within a grade block. Rank/Highlight/Remark come straight out of
/// TopPriceEngine's ranking algorithm — IsOurs marks Asia Siyaka's own rows so the frontend can
/// highlight them without re-deriving broker identity.</summary>
public record RankedLotRowDto(
    int Rank,
    string Broker,
    string SellingMark,
    string Grade,
    string? SubElevation,
    decimal Price,
    string? Buyer,
    string? BuyerName,
    bool IsOurs,
    string? Remark);

public record GradeBlockDto(string Grade, List<RankedLotRowDto> Rows);

public record ReportBlockDto(string Title, List<GradeBlockDto> Grades);

public record AuctionReportSheetDto(string Title, bool IncludeElevation, List<ReportBlockDto> Blocks);

public record AuctionReportStatsDto(int Top, int Top4, int Absent, int Total, int Rows, int Outsold);

public record AuctionReportDto(
    string ReportKey,
    string Title,
    string SourceName,
    DateTime GeneratedAt,
    AuctionReportStatsDto Stats,
    List<AuctionReportSheetDto> Sheets);

public record CombinedReportDto(string SourceName, DateTime GeneratedAt, List<AuctionReportDto> Reports);
