namespace Asc.Api.Modules.Reports;

/// <summary>Value stays a raw number, not a pre-formatted string — the frontend already has
/// formatCurrency/formatNumber (see the Dashboard page) and this keeps formatting in one
/// place instead of duplicating it server-side. Format picks which one to apply.</summary>
public record KpiDto(string Label, decimal? Value, string Format);

public record GroupRowDto(string Label, int Count, decimal? AverageValue, double? Percent);

/// <summary>Every report type reduces to one of these two shapes — a KPI tile grid, a
/// group-by table, or both — so a single generic section covers all report types instead
/// of a bespoke response shape per type.</summary>
public record ReportSectionDto(string Title, List<KpiDto>? Kpis, string? GroupUnitLabel, List<GroupRowDto>? Groups);

/// <summary>SourceName is one field for the whole report, not per-section, because every
/// section today derives from the same single catalogue file. When a future data source
/// (an MSL/OKLO/Tea Board import, a warehouse API, ...) starts feeding an individual
/// *section* rather than the whole report, that's the point to add a per-section Source
/// field to ReportSectionDto — not before, and not as a guess at that source's shape.</summary>
public record ReportDto(string Type, string Title, string Subtitle, string SourceName, DateTime GeneratedAt, List<ReportSectionDto> Sections);

public record SavedReportDto(Guid Id, string Type, string Title, Guid? CatalogueId, string? Source, DateTime CreatedAt);

public record SaveReportRequestDto(string Type, string Title, Guid? CatalogueId, string? Source);
