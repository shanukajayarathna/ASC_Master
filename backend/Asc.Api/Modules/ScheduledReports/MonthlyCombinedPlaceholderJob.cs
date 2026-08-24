using Asc.Api.Models;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// Proves the scheduler/execution/storage/audit/admin-visibility pipeline end-to-end for a
/// second job type before its real content and logic exist. Runs monthly, writes one clearly
/// labeled placeholder into Saved Reports, and reports a normal success — deliberately never
/// fails, since "ran and wrote the placeholder" is the whole job. Replace RunAsync's body with
/// the real Combined Report logic once that spec exists; Key, DisplayName and Trigger can stay
/// as-is if the report keeps its monthly cadence.
/// </summary>
public class MonthlyCombinedPlaceholderJob(ISavedReportsService savedReports) : IScheduledReportJob
{
    public string Key => "monthly-combined";
    public string DisplayName => "Monthly Combined Report";

    // Midnight on the 1st of every month.
    public ReportJobTrigger Trigger => ReportJobTrigger.Schedule("0 0 1 * *");

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var report = await savedReports.SaveAsync(new SavedReport
        {
            Type = Key,
            Title = $"Combined Report — {now:MMMM yyyy}",
            Notes = "Not yet configured, awaiting spec.",
            Source = "Generated automatically on schedule",
        }, ct);

        return ScheduledReportJobRunResult.Ok($"Placeholder written for {now:MMMM yyyy}.", report.Id);
    }
}
