using Asc.Api.Data;
using Asc.Api.Modules.Msl;
using Asc.Api.Modules.ScheduledReports;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Produces FactoryMarkPerformanceFact the moment a sale closes. Same closed-sale detection
/// and lookback-window shape as FactorySaleSummaryReportJob (MslWeeklyReportService.
/// FindRecentlyClosedSalesAsync), but idempotency is checked against
/// FactoryMarkPerformanceFacts itself — an existing fact for a period means it was already
/// mined — rather than SavedReports, since this job's output is durable Mongo documents, not
/// a generated file.
///
/// The initial ~2-year historical backfill is a separate, manually-triggered pass (see
/// FactoryMarkPerformanceController's backfill endpoint) — this job only ever looks at the
/// recent lookback window, exactly like its siblings.
/// </summary>
public class FactoryMarkPerformanceReportJob(
    MslWeeklyReportService wesService,
    FactoryMarkPerformanceMiningService mining,
    MongoContext db,
    ILogger<FactoryMarkPerformanceReportJob> logger) : IScheduledReportJob
{
    private static readonly TimeSpan LookbackWindow = TimeSpan.FromDays(21);

    public string Key => "factory-mark-performance";
    public string DisplayName => "Factory & Mark Performance Facts";
    public ReportJobTrigger Trigger => ReportJobTrigger.AfterSaleClose();
    public ReportJobCadence Cadence => ReportJobCadence.Weekly;

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var closedSales = await wesService.FindRecentlyClosedSalesAsync(LookbackWindow, ct);
        if (closedSales.Count == 0) return ScheduledReportJobRunResult.Ok("No sales closed in the lookback window.");

        var toMine = new List<(int Year, int SaleNo)>();
        foreach (var (year, saleNo, _) in closedSales)
        {
            // TODO: API migration — replace MongoDB access with remote API client once backend migration lands.
            var alreadyMined = await db.FactoryMarkPerformanceFacts.Find(f => f.SaleYear == year && f.SaleNo == saleNo).AnyAsync(ct);
            if (!alreadyMined) toMine.Add((year, saleNo));
        }
        if (toMine.Count == 0) return ScheduledReportJobRunResult.Ok("Nothing new to mine.");

        List<SaleMiningResult> results;
        try
        {
            results = (await mining.MineForSalesAsync(toMine, ct)).ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Factory & Mark performance mining failed for {Count} period(s).", toMine.Count);
            return ScheduledReportJobRunResult.Failed($"Mining failed: {ex.Message}");
        }

        var summary = string.Join(" ", results.Select(r =>
            $"Sale {r.SaleNo}/{r.SaleYear} ({r.Source}): {r.MarkFactsWritten} mark facts, {r.FactoryFactsWritten} factory facts."));
        return ScheduledReportJobRunResult.Ok(summary);
    }
}
