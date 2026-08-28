using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;
using Asc.Api.Modules.ScheduledReports;
using Asc.Api.Services;

namespace Asc.Api.Modules.CategoryReports;

/// <summary>
/// The Category Analysis report — "Price & Classification, Sale x Broker" plus its supporting
/// broker/status/tier/trend sheets (see CategoryAnalysisEngine/CategoryAnalysisWorkbookBuilder)
/// — for a chosen Category value (defaults to "Ex-estate") across one or more sales. Shape
/// mirrors FactorySaleSummaryReportJob: same SavedReport/IGeneratedReportFileStore output path,
/// same on-demand-vs-automatic split. Unlike Factory Sale Summary, this reads straight from
/// ICatalogueSource (the same sale-catalogue Excel store TopPriceEngine/LotsController use) —
/// Category, Status and Purchased Price all live there, not in the MSL AuctionLots archive,
/// which has no Category field at all.
/// </summary>
public class EstateCategoryReportJob(
    ICatalogueSource catalogueSource,
    IGeneratedReportFileStore fileStore,
    ISavedReportsService savedReports,
    ILogger<EstateCategoryReportJob> logger) : IScheduledReportJob
{
    public const string DefaultCategory = "Ex-estate";

    /// <summary>How many of the most-recently-closed sales the automatic run rolls up into one
    /// report — matches the trailing-4-sale window the flagship sheet was originally hand-built
    /// with (roughly a month of weekly sales).</summary>
    private const int TrailingSalesWindow = 4;

    public string Key => "estate-category-analysis";
    public string DisplayName => "Category Analysis (Price & Classification — Sale x Broker)";
    public ReportJobTrigger Trigger => ReportJobTrigger.AfterSaleClose();
    public ReportJobCadence Cadence => ReportJobCadence.Weekly;

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var closed = ClosedCataloguesNewestFirst(DefaultCategory).Take(TrailingSalesWindow).ToList();
        if (closed.Count == 0) return ScheduledReportJobRunResult.Ok($"No closed sales with \"{DefaultCategory}\" lots yet.");

        var (latestId, latestNo, latestYear) = closed[0];
        if (await savedReports.ExistsForSaleAsync(Key, latestYear, latestNo, ct))
            return ScheduledReportJobRunResult.Ok($"Already generated through Sale {latestNo}/{latestYear}.");

        try
        {
            var savedId = await GenerateAsync(DefaultCategory, [.. closed.Select(c => c.Id)], "Generated automatically on sale close", ct);
            return ScheduledReportJobRunResult.Ok($"Generated through Sale {latestNo}/{latestYear} (saved {savedId}).", savedId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Category analysis generation failed");
            return ScheduledReportJobRunResult.Failed(ex.Message);
        }
    }

    /// <summary>On-demand generation for a user-chosen category and sale selection — the report
    /// page's own "Generate" button. Always regenerates fresh and adds a new SavedReport, same
    /// "just run it again" behavior every other manual generate flow in this app has.</summary>
    public async Task<Guid> GenerateAsync(string category, List<Guid> catalogueIds, string source, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(category)) throw new InvalidOperationException("A category is required.");
        if (catalogueIds.Count == 0) throw new InvalidOperationException("At least one sale must be selected.");

        var lots = new List<Lot>();
        foreach (var id in catalogueIds)
        {
            var catalogueLots = catalogueSource.GetLots(id);
            if (catalogueLots is not null) lots.AddRange(catalogueLots);
        }
        if (lots.Count == 0) throw new InvalidOperationException("None of the selected sales could be loaded.");

        var data = CategoryAnalysisEngine.Build(lots, category);
        if (data.Summary.TotalLots == 0)
            throw new InvalidOperationException($"No lots found for category \"{category}\" in the selected sale(s).");

        var bytes = CategoryAnalysisWorkbookBuilder.Build(data);
        var latestSale = data.Sales.OrderByDescending(x => x.SaleYear).ThenByDescending(x => x.SaleNo).First();

        using var ms = new MemoryStream(bytes);
        var fileName = $"category-analysis_{Slug(category)}_through-sale{latestSale.SaleNo}_{latestSale.SaleYear}.xlsx";
        var storedFileId = await fileStore.SaveAsync(
            ms, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ct);

        var saleLabel = data.Sales.Count == 1 ? data.Sales[0].Label : $"{data.Sales.Count} sales through {latestSale.Label}";
        var report = await savedReports.SaveAsync(new SavedReport
        {
            Type = Key,
            Title = $"{category} Category Analysis — {saleLabel}",
            SaleYear = latestSale.SaleYear,
            SaleNo = latestSale.SaleNo,
            StoredFileId = storedFileId,
            Source = source,
        }, ct);

        return report.Id;
    }

    /// <summary>A catalogue counts as "closed" once a majority of its lots carry a post-auction
    /// Status at all — the same signal LotsController/TopPriceEngine implicitly rely on, and one
    /// that needs no MSL import to be true (a sale's own Excel gets Status/Purchased Price filled
    /// in directly once the auction runs, well before that sale shows up in the MSL archive).</summary>
    private IEnumerable<(Guid Id, int SaleNo, int SaleYear)> ClosedCataloguesNewestFirst(string category)
    {
        foreach (var c in catalogueSource.ListCatalogues())
        {
            var lots = catalogueSource.GetLots(c.Id);
            if (lots is null || lots.Count == 0) continue;

            // Not just "has a Status at all" — a not-yet-run sale's rows are pre-filled with
            // "Pending", which is non-empty but not a real outcome. Require an actual
            // Sold/Outsold/Unsold verdict on most rows, same positive-match rule the engine uses.
            var withOutcome = lots.Count(l => TopPriceEngine.IsSold(l) || TopPriceEngine.IsOutsold(l) || CategoryAnalysisEngine.IsUnsold(l));
            if (withOutcome < lots.Count / 2) continue;

            var sample = lots.FirstOrDefault(l =>
                !string.IsNullOrWhiteSpace(l.Category) &&
                l.Category!.Trim().Equals(category, StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(l.SaleNo, out _) && int.TryParse(l.SaleYear, out _))
                ?? lots.FirstOrDefault(l => int.TryParse(l.SaleNo, out _) && int.TryParse(l.SaleYear, out _));
            if (sample is null) continue;

            yield return (c.Id, int.Parse(sample.SaleNo!), int.Parse(sample.SaleYear!));
        }
    }

    private static string Slug(string category) =>
        new string([.. category.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')])
            .Trim('-');
}
