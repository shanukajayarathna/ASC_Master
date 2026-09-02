using Asc.Api.Modules.ScheduledReports;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Thin IScheduledReportJob adapter over MarkAscActivityCheckService. Key/DisplayName/cron
/// are supplied per-instance via the constructor so the same class serves both the 3-month
/// and 6-month registrations (see Program.cs) — both now call the exact same dual-threshold
/// evaluation (see MarkAscActivityCheckService's own doc comment for why a per-job single
/// window used to be wrong); keeping two registrations still satisfies the spec's two named
/// triggers and gives independent schedule/enable-disable/run-history in the Admin Panel,
/// plus redundancy if one is disabled or fails. Doesn't produce a Saved Report — it updates
/// Mark/MarkActivitySnapshot state directly, so ScheduledReportJobRunResult's SavedReportId
/// is always null here.
/// </summary>
public class MarkAscActivityCheckJob(
    MarkAscActivityCheckService service,
    string key,
    string displayName,
    string cron) : IScheduledReportJob
{
    public string Key => key;
    public string DisplayName => displayName;
    public ReportJobTrigger Trigger => ReportJobTrigger.Schedule(cron);
    public ReportJobCadence Cadence => ReportJobCadence.Weekly;

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var result = await service.RunAsync(key, ct);
        return ScheduledReportJobRunResult.Ok(
            $"{result.MarksEvaluated} marks evaluated: {result.NowAtRisk} at risk, {result.NowLost} lost, " +
            $"{result.Recovered} recovered, {result.NewlyIncoming} newly incoming, {result.NewlyShared} newly shared, " +
            $"{result.UnresolvedMarksSeen} unresolved marks seen.");
    }
}
