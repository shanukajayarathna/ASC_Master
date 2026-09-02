using Asc.Api.Models;
using Asc.Api.Modules.ScheduledReports;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Builds and saves the "Sharing Mark Catalogued Summary" workbook — manual-only, on
/// demand from the Reports page. Two entry points:
///  - GenerateForSaleAsync: from /data/sales, for a sale already ingested there.
///  - GenerateFromUploadAsync: from raw per-broker pre-sale catalogue files uploaded
///    through the new upload page, for a sale that hasn't happened yet and so has no
///    /data/sales file at all (see SharedMarkCatalogueService's own doc comment for why
///    this report can't wait on /data/sales — this used to be an AfterSaleClose
///    IScheduledReportJob; that trigger could never fire in time for these files, so it
///    was dropped in favor of upload-driven generation only).
/// Both funnel into the same SharedMarkCatalogueWorkbookBuilder/SavedReport output path,
/// matching every other manual-generate report in this app (e.g.
/// FactorySaleSummaryReportJob.GenerateForSaleAsync).
/// </summary>
public class SharedMarkCatalogueGenerationService(
    SharedMarkCatalogueService aggregator,
    IGeneratedReportFileStore fileStore,
    ISavedReportsService savedReports)
{
    public const string ReportType = "shared-mark-catalogue-summary";

    public Task<Guid> GenerateForSaleAsync(int year, int saleNo, CancellationToken ct) =>
        SaveAsync(() => aggregator.AggregateAsync(year, saleNo, ct), "Generated from /data/sales", ct);

    public Task<Guid> GenerateFromUploadAsync(int year, int saleNo, DateTime saleDate, IReadOnlyList<Lot> uploadedLots, CancellationToken ct) =>
        SaveAsync(() => aggregator.AggregateFromUploadAsync(year, saleNo, saleDate, uploadedLots, ct), "Generated from broker file upload", ct);

    private async Task<Guid> SaveAsync(Func<Task<SharedMarkCatalogueResult>> aggregate, string source, CancellationToken ct)
    {
        var result = await aggregate();
        if (result.Rows.Count == 0) throw new InvalidOperationException("No shared marks found for this sale.");

        var bytes = SharedMarkCatalogueWorkbookBuilder.Build(result);

        using var ms = new MemoryStream(bytes);
        var fileName = $"shared-mark-catalogue-summary_sale{result.SaleNo}_{result.SaleYear}.xlsx";
        var storedFileId = await fileStore.SaveAsync(
            ms, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ct);

        var report = await savedReports.SaveAsync(new SavedReport
        {
            Type = ReportType,
            Title = $"Sharing Mark Catalogued Summary - Sale {result.SaleNo}/{result.SaleYear} ({result.SaleDate:dd MMM yyyy})",
            SaleYear = result.SaleYear,
            SaleNo = result.SaleNo,
            StoredFileId = storedFileId,
            Source = source,
        }, ct);

        return report.Id;
    }
}
