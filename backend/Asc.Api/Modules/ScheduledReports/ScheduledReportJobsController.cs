using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>Reports &gt; Automated Reports page — list every registered job with its current
/// state, toggle it, or force a run. Open to any signed-in user (these jobs only ever touch
/// their own generated reports, never the underlying sale data — no Admin-only gate needed).
/// Run history is deliberately not duplicated here: see AuditLogController's entityType/
/// entityId filter (EntityType="ScheduledReportJob", EntityId=the job's Key) — one history
/// mechanism for the whole app, not a second one.</summary>
[ApiController]
[Route("api/v1/admin/scheduled-reports")]
[Authorize]
public class ScheduledReportJobsController(
    IScheduledReportJobRegistry registry, ScheduledReportRunnerService runner, MongoContext db,
    ISavedReportsService savedReports) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<ScheduledReportJobDto>>> List(CancellationToken ct)
    {
        var states = await db.ScheduledReportJobStates.Find(FilterDefinition<ScheduledReportJobState>.Empty).ToListAsync(ct);
        var byKey = states.ToDictionary(s => s.Key);

        return Ok(registry.All.Select(job =>
        {
            var state = byKey.GetValueOrDefault(job.Key);
            return new ScheduledReportJobDto(
                job.Key, job.DisplayName, job.Trigger.Type.ToString(), job.Trigger.CronExpression, job.Cadence.ToString(),
                state?.Enabled ?? true, state?.LastRunAt,
                (state?.LastStatus ?? ScheduledReportJobLastStatus.NeverRun).ToString(),
                state?.LastMessage, state?.LastDurationMs ?? 0, state?.ConsecutiveFailures ?? 0);
        }).ToList());
    }

    [HttpPost("{key}/toggle")]
    public async Task<IActionResult> Toggle(string key, ToggleJobRequestDto dto, CancellationToken ct)
    {
        if (registry.Find(key) is null) return NotFound($"No registered job '{key}'.");

        var update = Builders<ScheduledReportJobState>.Update.Set(s => s.Enabled, dto.Enabled);
        await db.ScheduledReportJobStates.UpdateOneAsync(
            s => s.Key == key, update, new UpdateOptions { IsUpsert = true }, ct);
        return NoContent();
    }

    [HttpPost("{key}/run-now")]
    public async Task<ActionResult<RunNowResponseDto>> RunNow(string key, CancellationToken ct)
    {
        var job = registry.Find(key);
        if (job is null) return NotFound($"No registered job '{key}'.");

        var result = await runner.RunNowAsync(job, User, ct);
        return Ok(new RunNowResponseDto(result.Success, result.Message));
    }

    /// <summary>What this job has actually produced — the "output link" half of run history
    /// (the success/failure/duration half is AuditLogController's own entityType/entityId
    /// filter). Downloading a listed output goes through ReportsController's general
    /// GET /reports/saved/{id}/download — one download endpoint for the whole app, not a
    /// second admin-only copy of it. Only the reports with a StoredFileId are downloadable;
    /// the monthly placeholder job's output never has one (there's no file, just a Saved
    /// Reports entry).</summary>
    [HttpGet("{key}/outputs")]
    public async Task<ActionResult<List<SavedReportSummaryDto>>> Outputs(string key, CancellationToken ct)
    {
        if (registry.Find(key) is null) return NotFound($"No registered job '{key}'.");

        var reports = await savedReports.ListByTypeAsync(key, 20, ct);
        return Ok(reports.Select(r => new SavedReportSummaryDto(r.Id, r.Title, r.CreatedAt, r.Notes, r.StoredFileId.HasValue)).ToList());
    }
}
