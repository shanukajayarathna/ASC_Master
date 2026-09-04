using Asc.Api.Models;
using Asc.Api.Modules.ScheduledReports;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Builds and saves the "Sharing Mark Catalogued Summary" workbooks — manual-only, on
/// demand from the Reports page. Two entry points:
///  - GenerateForSaleAsync: from /data/sales, for a sale already ingested there.
///  - GenerateFromUploadAsync: from raw per-broker pre-sale catalogue files uploaded
///    through the new upload page, for a sale that hasn't happened yet and so has no
///    /data/sales file at all (see SharedMarkCatalogueService's own doc comment for why
///    this report can't wait on /data/sales — this used to be an AfterSaleClose
///    IScheduledReportJob; that trigger could never fire in time for these files, so it
///    was dropped in favor of upload-driven generation only).
/// Both produce TWO SavedReports per run — one for Low Grown, one for High & Medium
/// Grown — mirroring the user's original two separate hand-built files rather than one
/// two-sheet workbook, so the Outputs list and downloads map 1:1 onto them.
/// </summary>
public record GenerationResult(List<Guid> SavedReportIds, IReadOnlyList<string> UnmatchedMarks);

public class SharedMarkCatalogueGenerationService(
    SharedMarkCatalogueService aggregator,
    IGeneratedReportFileStore fileStore,
    ISavedReportsService savedReports)
{
    public const string ReportType = "shared-mark-catalogue-summary";

    public Task<GenerationResult> GenerateForSaleAsync(int year, int saleNo, CancellationToken ct) =>
        SaveBothAsync(() => aggregator.AggregateAsync(year, saleNo, ct), "Generated from /data/sales", ct);

    public Task<GenerationResult> GenerateFromUploadAsync(int year, int saleNo, DateTime saleDate, IReadOnlyList<Lot> uploadedLots, CancellationToken ct) =>
        SaveBothAsync(() => aggregator.AggregateFromUploadAsync(year, saleNo, saleDate, uploadedLots, ct), "Generated from broker file upload", ct);

    private static readonly (string Bucket, string FileSuffix)[] Buckets =
    [
        ("Low Grown", "low-grown"),
        ("High & Medium Grown", "high-medium-grown"),
    ];

    private async Task<GenerationResult> SaveBothAsync(Func<Task<SharedMarkCatalogueResult>> aggregate, string source, CancellationToken ct)
    {
        var result = await aggregate();
        if (result.Rows.Count == 0) throw new InvalidOperationException("No shared marks found for this sale.");

        var ids = new List<Guid>();
        foreach (var (bucket, fileSuffix) in Buckets)
        {
            var bucketRows = result.Rows.Where(r => r.ElevationBucket == bucket).ToList();
            if (bucketRows.Count == 0) continue;

            var bytes = SharedMarkCatalogueWorkbookBuilder.BuildBucket(result, bucket, bucketRows);

            using var ms = new MemoryStream(bytes);
            var fileName = $"shared-mark-catalogue-summary_{fileSuffix}_sale{result.SaleNo}_{result.SaleYear}.xlsx";
            var storedFileId = await fileStore.SaveAsync(
                ms, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ct);

            var report = await savedReports.SaveAsync(new SavedReport
            {
                Type = ReportType,
                Title = $"Sharing Mark Catalogued Summary - {bucket} - Sale {result.SaleNo}/{result.SaleYear} ({result.SaleDate:dd MMM yyyy})",
                SaleYear = result.SaleYear,
                SaleNo = result.SaleNo,
                StoredFileId = storedFileId,
                Source = source,
            }, ct);

            ids.Add(report.Id);
        }

        return new GenerationResult(ids, result.UnmatchedMarks);
    }
}
