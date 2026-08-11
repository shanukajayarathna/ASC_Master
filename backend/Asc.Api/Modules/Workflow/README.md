# Workflow layer: n8n today, Temporal later

`IWorkflowService.TriggerAsync(eventName, payload, ct)` is the only seam the rest of the app
uses to reach an external automation engine — no business code, agent, or controller ever
talks to n8n, an HTTP client, or a workflow engine's SDK directly. That indirection is what
makes swapping the engine later a DI change, not a rewrite.

## What exists today

`N8nWorkflowProvider` is the only implementation, and it's intentionally thin: it delegates
straight to `IWebhookSender` (`Modules/Webhooks`), which already does the real work — an
HMAC-signed POST to whatever URL an admin subscribed to a given event name via the existing
webhook admin UI. There is no live n8n instance wired into this project; n8n (or any other
tool) becomes involved the moment someone points a real webhook subscription at
`catalogue.imported` or `notification.whatsapp` (the two event names that exist today — see
`WebhooksController.KnownEvents`).

## Why Temporal, and why not yet

Temporal is durable workflow orchestration: retries, timers, human-in-the-loop steps, and
long-running state survive process restarts, which a fire-and-forget webhook POST cannot do.
That matters once a workflow needs to *wait* — e.g. "escalate if a catalogue isn't
acknowledged within 4 hours" (today's `DeadlineEngine` approximates this with a polling
background service, not a durable timer) — or *retry with backoff* across a multi-step
process spanning minutes or hours.

It is not implemented now because:
- No workflow in this app yet needs durability beyond what `DeadlineCheckService`'s polling
  loop already provides.
- Temporal requires running its own server (or paying for Temporal Cloud) — real
  infrastructure this project doesn't have and the architecture directive explicitly said not
  to add prematurely.
- Introducing it before a concrete workflow needs it would be exactly the "n8n hard
  dependency" mistake this abstraction exists to avoid, just aimed at a different vendor.

## What the swap looks like when it's time

1. Add a `Temporal.Client` (or equivalent) package reference and implement
   `TemporalWorkflowProvider : IWorkflowService`, translating `TriggerAsync(eventName, payload, ct)`
   into a Temporal workflow-start call (a `Signal` or `StartWorkflow`, depending on whether
   the target workflow already exists for that entity).
2. Swap the one DI line in `Program.cs`:
   ```csharp
   // before
   builder.Services.AddSingleton<IWorkflowService>(sp => new N8nWorkflowProvider(sp.GetRequiredService<IWebhookSender>()));
   // after
   builder.Services.AddSingleton<IWorkflowService, TemporalWorkflowProvider>();
   ```
3. Nothing else changes. `NotificationService.SendWhatsAppMessageAsync`, `DeadlineCheckService`,
   and every future caller of `IWorkflowService` keep compiling and behaving the same — they
   only ever called `TriggerAsync`, never anything n8n-specific.

`IWebhookSender`/`WebhooksController` don't disappear when this happens — they're a
general-purpose outbound-event mechanism independent of the workflow engine question, useful
for any external system (not just a workflow engine) that wants to subscribe to ASC events.
