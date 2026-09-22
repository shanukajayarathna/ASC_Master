namespace Asc.Api.Modules.FactoryGrademix;

/// <summary>One grade line of the company-format grademix sheet. QtyPct/AvgRs are null for a
/// grade that has no price (the expected table, when a grade has no sales history to price it
/// from) — such a grade is listed but left out of every share and average.</summary>
public record GradeRowDto(string Grade, decimal Qty, decimal? AvgRs, decimal? QtyPct, decimal? PrevQtyPct, string? PriceBasis);

/// <summary>A summed group (Total main, PEK/PEK1, Small leafy, Off grade, All lots ...).
/// ContriValue = (AvgRs - national avg) x QtyPct/100 — the group's contribution to the factory
/// average above or below the national average; the leafy/small-leafy/off-grade groups sum to
/// (factory avg - national avg).</summary>
public record GroupRowDto(string Name, decimal Qty, decimal QtyPct, decimal? AvgRs, decimal ContriValue);

public record GrademixTableDto(
    List<GradeRowDto> Main, List<GradeRowDto> Off,
    GroupRowDto TotalMain, GroupRowDto TotalOff, GroupRowDto All,
    List<GroupRowDto> Leafy, GroupRowDto TotalLeafy, GroupRowDto SmallLeafy, GroupRowDto OffGrade,
    decimal TotalContri, decimal? FactoryAvgRs, decimal NationalAvgRs, decimal UnpricedKg);

public record SaleRefDto(int Year, int SaleNo, DateTime? Date);

public record FactoryInfoDto(string Code, string Name, string? Elevation, string? ElevationLabel, string Section, List<string> Marks);

/// <summary>The "National Avg" the contribution values are measured against — the Tea Board's
/// monthly elevation average for this factory's elevation and Orthodox/CTC side. IsStale is true
/// when the Tea Board has not yet published the sale's own month, so the latest published month
/// stands in (Label says which). Basis is "tea-board", or "sale-elevation"/"sale-all" when no Tea
/// Board figure exists at all and the sale's own lots stand in.</summary>
public record NationalRefDto(decimal AvgRs, string Basis, string Label, bool IsStale, decimal? SaleElevationAvgRs);

public record MonthlyPointDto(int Year, int Month, string Label, int Sales, decimal SoldKg, decimal? AvgRs, decimal? TeaBoardAvgRs, bool InProgress);

public record PresentSaleDto(SaleRefDto Sale, decimal OfferedKg, decimal SoldKg, decimal UnsoldKg, GrademixTableDto Table);

public record ElevationOutlookDto(string Elevation, string Label, decimal Kg, decimal SharePct, decimal? ExpectedAvgRs, decimal? TeaBoardAvgRs, bool IsFactoryElevation);

/// <summary>The entire upcoming catalogue (every factory), so the factory can see the market it
/// is selling into. ExpectedAvgRs per elevation is the trailing average of the same price-basis
/// sales the factory's own expected prices use.</summary>
public record WholeSaleDto(decimal TotalKg, int Lots, int Factories, List<ElevationOutlookDto> Elevations, decimal FactoryShareOfSalePct);

/// <summary>Table is null when the factory has no lots in the upcoming catalogue.</summary>
public record UpcomingSaleDto(
    SaleRefDto Sale, decimal CatalogueKg, GrademixTableDto? Table, WholeSaleDto WholeSale,
    List<SaleRefDto> PriceBasisSales, decimal? ExpectedVsPresentRs);

public record FactoryGrademixReportDto(
    FactoryInfoDto Factory, NationalRefDto National, PresentSaleDto Present,
    List<MonthlyPointDto> Monthly, UpcomingSaleDto? Upcoming, DateTime GeneratedAt);

public record CompareGroupDto(string Name, decimal QtyPct, decimal ContriValue);

public record CompareFactoryDto(
    FactoryInfoDto Factory, decimal SoldKg, decimal? AvgRs, decimal NationalAvgRs,
    List<CompareGroupDto> Groups, List<MonthlyPointDto> Monthly, decimal? ExpectedAvgRs);

public record FactoryGrademixSaleDto(int Year, int SaleNo, DateTime? Date);

public record FactoryOptionDto(string Code, string Name, string? ElevationLabel);
