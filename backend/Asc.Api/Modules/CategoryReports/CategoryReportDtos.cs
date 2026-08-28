namespace Asc.Api.Modules.CategoryReports;

/// <summary>One value seen in the Category column, with how many lots carry it — powers the
/// category picker on the report page (defaults to "Ex-estate" when present).</summary>
public record CategoryOptionDto(string Category, int LotCount);

public record SaleRefDto(int SaleNo, int SaleYear, string Label);

public record BrokerDistributionRowDto(
    string Broker, int Lots, double SharePct, int DistinctMarks,
    decimal QtyOfferedKg, decimal QtySoldKg, decimal ProceedsRs, decimal AvgPriceRsKg);

public record StatusRowDto(
    string Broker, int Sold, int Outsold, int Unsold, int Total,
    double SoldPct, double OutsoldPct, double UnsoldPct);

public record TierRowDto(
    string Tier, int Lots, double SharePct, decimal QtyKg,
    decimal AvgPriceRsKg, decimal MinPriceRsKg, decimal MaxPriceRsKg);

public record TierBrokerRowDto(string Tier, string Broker, int Lots, decimal QtyKg, decimal AvgPriceRsKg);

public record SaleTrendRowDto(
    int SaleNo, int SaleYear, int LotsOffered, int Sold, int Outsold, int Unsold, double SoldPct,
    decimal QtyOfferedKg, decimal QtySoldKg, decimal AvgPriceRsKg, decimal ProceedsRs);

/// <summary>The flagship table: one row per (sale, broker) — achieved price plus the full
/// Select Best/Best/Below Best/Poor split for that broker's sold lots in that one sale. This is
/// "Price & Classification — Sale x Broker" in both the workbook and the on-screen preview.</summary>
public record SaleBrokerRowDto(
    int SaleNo, int SaleYear, string Broker, int Lots, int Sold, double SoldPct, decimal AvgPriceRsKg,
    int SelectBestLots, double SelectBestSharePct, decimal SelectBestAvgPriceRsKg,
    int BestLots, double BestSharePct, decimal BestAvgPriceRsKg,
    int BelowBestLots, double BelowBestSharePct, decimal BelowBestAvgPriceRsKg,
    int PoorLots, double PoorSharePct, decimal PoorAvgPriceRsKg);

public record CategoryAnalysisSummaryDto(int TotalLots, int Sold, int Outsold, int Unsold, int BrokerCount, int DistinctMarks);

public record CategoryAnalysisDto(
    string Category,
    List<SaleRefDto> Sales,
    CategoryAnalysisSummaryDto Summary,
    List<BrokerDistributionRowDto> BrokerDistribution,
    List<StatusRowDto> Status,
    List<TierRowDto> Tiers,
    List<TierBrokerRowDto> TierByBroker,
    List<SaleTrendRowDto> Trend,
    List<SaleBrokerRowDto> SaleBroker);

public record GenerateCategoryAnalysisRequestDto(string Category, List<Guid> CatalogueIds);
