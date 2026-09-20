using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.ScheduledReports;
using MongoDB.Driver;

namespace Asc.Api.Modules.Reports;

/// <summary>
/// Every Monday at 06:00, re-runs each enabled report spec people scheduled from the Reports workspace and saves the
/// result as a Saved Report snapshot (the same kind "Save snapshot" makes). Uses the workspace's own query
/// (CustomReportTools.PreviewAsync), so the figures come from the archive, not a model. One spec failing never stops
/// the others; the job only reports failure when every spec failed.
/// </summary>
public class CustomReportSpecsJob(MongoContext db, CustomReportTools tools, ISavedReportsService savedReports, ILogger<CustomReportSpecsJob> logger) : IScheduledReportJob
{
    /// <summary>Archive queries are the heavy part of this app, so one run is bounded.</summary>
    public const int MaxSpecsPerRun = 25;

    public string Key => "custom-report-specs";
    public string DisplayName => "Scheduled custom reports";
    public ReportJobTrigger Trigger => ReportJobTrigger.Schedule("0 6 * * 1");
    public ReportJobCadence Cadence => ReportJobCadence.Weekly;

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var specs = await db.CustomReportSpecs.Find(s => s.Enabled).SortBy(s => s.CreatedAt).Limit(MaxSpecsPerRun).ToListAsync(ct);
        if (specs.Count == 0) return ScheduledReportJobRunResult.Ok("No scheduled reports.");

        int ok = 0, failed = 0;
        foreach (var spec in specs)
        {
            ct.ThrowIfCancellationRequested();
            var (savedId, error) = await RunSpecAsync(spec, ct);
            await db.CustomReportSpecs.UpdateOneAsync(s => s.Id == spec.Id,
                Builders<CustomReportSpec>.Update.Set(s => s.LastRunAt, DateTime.UtcNow).Set(s => s.LastSavedReportId, savedId ?? spec.LastSavedReportId).Set(s => s.LastError, error),
                cancellationToken: ct);
            if (error is null) ok++; else failed++;
        }

        var message = $"{ok} report(s) saved{(failed > 0 ? $", {failed} failed" : "")}.";
        return ok == 0 ? ScheduledReportJobRunResult.Failed(message) : ScheduledReportJobRunResult.Ok(message);
    }

    private async Task<(Guid? SavedId, string? Error)> RunSpecAsync(CustomReportSpec spec, CancellationToken ct)
    {
        try
        {
            var request = CustomReportSnapshot.Deserialize(spec.RequestJson);
            if (request is null) return (null, "The saved request could not be read.");

            var (preview, error) = await tools.PreviewAsync(CustomReportsController.ToArgs(request), ct);
            if (preview is null) return (null, error ?? "No data for that selection.");

            var saved = await savedReports.SaveAsync(new SavedReport
            {
                Type = SavedReport.CustomChartType,
                Title = $"{spec.Title} — {DateTime.UtcNow:dd MMM yyyy}",
                Source = "Scheduled report",
                Notes = $"Scheduled weekly by {spec.OwnerName}",
                Content = CustomReportSnapshot.Build(preview, spec.Visual),
            }, ct);
            return (saved.Id, null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Scheduled custom report {Spec} failed", spec.Id);
            return (null, ex.Message);
        }
    }
}
