namespace Asc.Api.Modules.ScheduledReports;

public enum ReportJobTriggerType
{
    /// <summary>Polled, not pushed — there is no explicit "close this sale" action anywhere
    /// in this app today, so a job with this trigger decides for itself, on every runner
    /// tick, whether anything newly-closed needs it. See WeeklyFactAutoReportJob's own doc
    /// comment for exactly what "closed" means.</summary>
    AfterSaleClose,

    /// <summary>A standard 5-field cron expression, evaluated by Cronos.</summary>
    Schedule,
}

/// <summary>A job's own declared trigger — display-only for AfterSaleClose (the runner ticks
/// every job every cycle regardless; the job's RunAsync is what actually no-ops when there's
/// nothing new), load-bearing for Schedule (CronExpression is required and drives when
/// ScheduledReportRunnerService actually invokes the job).</summary>
public record ReportJobTrigger(ReportJobTriggerType Type, string? CronExpression = null)
{
    public static ReportJobTrigger AfterSaleClose() => new(ReportJobTriggerType.AfterSaleClose);
    public static ReportJobTrigger Schedule(string cron) => new(ReportJobTriggerType.Schedule, cron);
}

public record ScheduledReportJobRunResult(bool Success, string Message, Guid? SavedReportId = null)
{
    public static ScheduledReportJobRunResult Ok(string message, Guid? savedReportId = null) => new(true, message, savedReportId);
    public static ScheduledReportJobRunResult Failed(string message) => new(false, message);
}

/// <summary>How often a job's own report is meant to land, for grouping in the Admin Panel's
/// "Automated Reports" list — independent of Trigger (an AfterSaleClose job is "Weekly"
/// because sales happen weekly; a Schedule job's cadence is whatever its cron actually means,
/// not derivable from the cron string itself). Purely a display/grouping concern today; it
/// exists so new weekly and monthly jobs both have an obvious, already-built slot to land in.</summary>
public enum ReportJobCadence
{
    Weekly,
    Monthly,
}

/// <summary>
/// One registered automated report job. Implement this and register it in Program.cs
/// (AddScoped/AddSingleton + join the IEnumerable&lt;IScheduledReportJob&gt; DI group the same
/// way every other job does) and ScheduledReportRunnerService, ScheduledReportJobsController
/// and the Admin Panel's "Automated Reports" list all pick it up automatically — no other code
/// change. Key must be a stable, unique, kebab-case identifier: it's the primary key for
/// ScheduledReportJobState and the EntityId every audit-log entry for this job carries, so
/// renaming it orphans that job's history.
/// </summary>
public interface IScheduledReportJob
{
    string Key { get; }
    string DisplayName { get; }
    ReportJobTrigger Trigger { get; }
    ReportJobCadence Cadence { get; }

    /// <summary>Called on the runner's own tick cadence (see ScheduledReportRunnerService).
    /// Must be cheap and safe to call when there is nothing to do — for an AfterSaleClose job
    /// that's every single tick; for a Schedule job the runner only calls this once its cron
    /// expression has actually elapsed. Implementations own their own idempotency (e.g. "have
    /// I already generated this sale's report?") — the runner does not track that.</summary>
    Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct);
}
