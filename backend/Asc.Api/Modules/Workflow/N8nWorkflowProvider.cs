using Asc.Api.Modules.Webhooks;

namespace Asc.Api.Modules.Workflow;

/// <summary>
/// Today's IWorkflowService implementation — n8n (or any other listener) subscribes to a
/// named event via the existing outbound-webhook admin UI (Modules/Webhooks), which was
/// already HMAC-signed, provider-agnostic, and n8n-shaped from the start; this class adds
/// no new integration, only the IWorkflowService name over it. A future
/// TemporalWorkflowProvider implements the same interface and replaces this in DI — nothing
/// that calls IWorkflowService needs to change when that happens.
/// </summary>
public class N8nWorkflowProvider(IWebhookSender webhooks) : IWorkflowService
{
    public Task TriggerAsync(string eventName, object payload, CancellationToken ct = default) =>
        webhooks.SendAsync(eventName, payload, ct);
}
