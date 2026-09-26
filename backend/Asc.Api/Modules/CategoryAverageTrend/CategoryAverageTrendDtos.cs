namespace Asc.Api.Modules.CategoryAverageTrend;

public record TrendSaleDto(int SaleNo, int SaleYear, string Label);

/// <summary>One sale's figure for a row: the weighted average price (Rs/kg) and its change against the
/// sale immediately before it. Either can be null — no sold lots that sale, or no earlier sale to compare.</summary>
public record TrendCellDto(decimal? Average, decimal? Change);

public record TrendGradeRowDto(string Grade, List<TrendCellDto> Cells);

public record TrendCategoryDto(string Name, bool LowGrownOnly, List<TrendCellDto> Cells, List<TrendGradeRowDto> Grades);

/// <summary>Sales are oldest to newest and each row's Cells line up with them one-to-one.</summary>
public record CategoryAverageTrendDto(
    string SelectedSale,
    List<TrendSaleDto> Sales,
    string? BaseSale,
    string? Broker,
    List<string> AvailableBrokers,
    bool HasResults,
    List<TrendCategoryDto> Categories);

public record LatestSaleWithResultsDto(Guid CatalogueId, string SourceName);
