namespace Asc.Api.Modules.Workflow;

/// <summary>
/// The seam between the application and whatever external automation/orchestration engine
/// is running workflows — n8n today, potentially Temporal or another engine later. Callers
/// (NotificationService, future business-rule triggers) only ever know "trigger this named
/// event with this payload," never which engine is listening or how it's reached.
/// </summary>
public interface IWorkflowService
{
    Task TriggerAsync(string eventName, object payload, CancellationToken ct = default);
}
