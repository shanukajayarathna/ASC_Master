using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.ScheduledReports;

public enum ScheduledReportJobLastStatus
{
    NeverRun,
    Succeeded,
    Waiting,
    Failed,
}

/// <summary>
/// Current state of one registered job — Key-keyed, one document per job, upserted after
/// every runner tick that actually invokes it. This is "what's the status of job X right now,"
/// distinct from the audit log ("what happened, in order") — the Admin Panel's job list reads
/// this collection; its run-history panel reads the audit log filtered by EntityId == Key (see
/// ScheduledReportJobsController). Enabled defaults true so a newly-registered job is live
/// immediately, matching every other opt-out (not opt-in) toggle in this app (e.g. Market
/// Pulse sources).
/// </summary>
public class ScheduledReportJobState
{
    [BsonId]
    public string Key { get; set; } = string.Empty;

    public bool Enabled { get; set; } = true;

    public DateTime? LastRunAt { get; set; }

    [BsonRepresentation(BsonType.String)]
    public ScheduledReportJobLastStatus LastStatus { get; set; } = ScheduledReportJobLastStatus.NeverRun;

    public string? LastMessage { get; set; }
    public long LastDurationMs { get; set; }

    /// <summary>Consecutive Failed results only — a Waiting result (e.g. "CBAC not staged
    /// yet") resets nothing but also doesn't increment this, so a job that's legitimately
    /// waiting on an upload never reads as "failing." Surfaced in the Admin Panel once this
    /// crosses a small threshold, the same "only show a warning block when something real
    /// needs attention" rule the Admin Dashboard already follows elsewhere.</summary>
    public int ConsecutiveFailures { get; set; }
}
