using System.Security.Claims;
using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Cronos;
using MongoDB.Driver;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// The one scheduler loop every registered IScheduledReportJob runs behind — adding a new job
/// type never touches this file. AfterSaleClose jobs are invoked every tick (they own their
/// own idempotency, so a no-op tick is cheap — see WeeklyFactAutoReportJob); Schedule jobs are
/// only invoked once their cron expression has actually elapsed since LastRunAt. Every job here
/// is registered singleton (see Program.cs) — none of them ultimately depend on a scoped
/// service the way MarketPulseIngestionService's jobs depend on the scoped AiGateway — so
/// unlike that service, this one needs no per-tick IServiceScopeFactory scope; it's the
/// simpler DeadlineCheckService shape.
/// </summary>
public class ScheduledReportRunnerService(
    IScheduledReportJobRegistry registry, MongoContext db, IAuditLogger auditLogger, ILogger<ScheduledReportRunnerService> logger)
    : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromMinutes(10);

    // A Failed result must read as a real problem in the Admin Panel before too long, but one
    // transient failure (a momentary Mongo hiccup, a slow internal call) shouldn't immediately
    // read as "broken" — matches DeadlineEngine's own "don't cry wolf on the first miss" stance.
    private const int FailureAlertThreshold = 3;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var job in registry.All)
            {
                try
                {
                    await RunOneIfDueAsync(job, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    // A bug in one job (or in this method's own state bookkeeping) must never
                    // take down the whole runner — every other registered job still needs its
                    // tick. Deliberately not `ex is not OperationCanceledException`-guarded:
                    // see AiGateway/MarketPulseScoringService's own history of exactly this bug.
                    logger.LogError(ex, "Scheduled report runner failed outside job {Key}'s own error handling", job.Key);
                }
            }

            try
            {
                await Task.Delay(TickInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Runs `job` right now regardless of schedule/enabled state — the Admin Panel's
    /// "Run Now" button. Still goes through the same state-tracking/audit-logging path as a
    /// normal tick, but attributed to the admin who clicked it rather than to SystemActor, so
    /// the audit log can actually distinguish a manual override from an automatic tick.</summary>
    public Task<ScheduledReportJobRunResult> RunNowAsync(IScheduledReportJob job, ClaimsPrincipal actor, CancellationToken ct) =>
        ExecuteAndRecordAsync(job, actor, ct);

    private async Task RunOneIfDueAsync(IScheduledReportJob job, CancellationToken ct)
    {
        var state = await db.ScheduledReportJobStates.Find(s => s.Key == job.Key).FirstOrDefaultAsync(ct);
        if (state is { Enabled: false }) return;

        if (job.Trigger.Type == ReportJobTriggerType.Schedule)
        {
            var cron = CronExpression.Parse(job.Trigger.CronExpression
                ?? throw new InvalidOperationException($"Job '{job.Key}' declares a Schedule trigger with no CronExpression."));
            var from = state?.LastRunAt ?? DateTime.UtcNow.AddMinutes(-1);
            var next = cron.GetNextOccurrence(from, inclusive: false);
            if (next is null || next > DateTime.UtcNow) return;
        }

        await ExecuteAndRecordAsync(job, SystemActor.ClaimsPrincipal, ct);
    }

    private async Task<ScheduledReportJobRunResult> ExecuteAndRecordAsync(IScheduledReportJob job, ClaimsPrincipal actor, CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        ScheduledReportJobRunResult result;
        try
        {
            result = await job.RunAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Scheduled report job {Key} threw", job.Key);
            result = ScheduledReportJobRunResult.Failed(ex.Message);
        }
        var durationMs = (long)(DateTime.UtcNow - started).TotalMilliseconds;

        // "Failed" only for a genuine failure; a message with nothing to report is still a
        // successful tick (matches WeeklyFactAutoReportJob's own Ok("Nothing new...") result).
        var status = result.Success ? ScheduledReportJobLastStatus.Succeeded : ScheduledReportJobLastStatus.Failed;

        var prior = await db.ScheduledReportJobStates.Find(s => s.Key == job.Key).FirstOrDefaultAsync(ct);
        var consecutiveFailures = status == ScheduledReportJobLastStatus.Failed ? (prior?.ConsecutiveFailures ?? 0) + 1 : 0;

        var state = new ScheduledReportJobState
        {
            Key = job.Key,
            Enabled = prior?.Enabled ?? true,
            LastRunAt = started,
            LastStatus = status,
            LastMessage = result.Message,
            LastDurationMs = durationMs,
            ConsecutiveFailures = consecutiveFailures,
        };
        await db.ScheduledReportJobStates.ReplaceOneAsync(s => s.Key == job.Key, state, new ReplaceOptions { IsUpsert = true }, ct);

        await auditLogger.LogAsync(
            actor,
            result.Success ? "scheduledReport.ran" : "scheduledReport.failed",
            entityType: "ScheduledReportJob",
            entityId: job.Key,
            details: result.Message,
            ct);

        if (!result.Success && consecutiveFailures >= FailureAlertThreshold)
            logger.LogWarning("Scheduled report job {Key} has failed {Count} times in a row: {Message}", job.Key, consecutiveFailures, result.Message);

        return result;
    }
}
