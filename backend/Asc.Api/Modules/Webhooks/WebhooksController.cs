using System.Security.Cryptography;
using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Webhooks;

/// <summary>Admin-only management of outbound webhook subscriptions. Same list/create/delete
/// shape and "secret shown once" principle as ApiKeysController.</summary>
[ApiController]
[Route("api/v1/webhooks")]
[Authorize(Policy = Policies.ManageWebhooks)]
public class WebhooksController(MongoContext db, IAuditLogger audit) : ControllerBase
{
    // "notification.whatsapp" is fired by NotificationService.SendWhatsAppMessageAsync — an
    // admin points an n8n workflow at it to actually deliver the message (no WhatsApp
    // Business API credentials exist yet, so nothing subscribes to it by default).
    private static readonly string[] KnownEvents = ["catalogue.imported", "notification.whatsapp"];

    [HttpGet("events")]
    public ActionResult<string[]> Events() => Ok(KnownEvents);

    [HttpPost]
    public async Task<ActionResult<WebhookCreatedDto>> Create(CreateWebhookRequestDto dto, CancellationToken ct)
    {
        // Trim first — a URL pasted from a browser address bar or another app commonly
        // carries a leading/trailing space or newline, which would otherwise fail parsing
        // for a reason invisible to whoever pasted it.
        var url = dto.Url?.Trim() ?? "";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            return BadRequest("That doesn't look like a full URL — it needs to start with http:// or https://, e.g. https://your-n8n-instance/webhook/abc123.");
        if (string.IsNullOrWhiteSpace(dto.Event)) return BadRequest("Event is required.");

        var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var sub = new WebhookSubscription { Url = url, Event = dto.Event, Secret = secret };
        await db.WebhookSubscriptions.InsertOneAsync(sub, cancellationToken: ct);
        await audit.LogAsync(User, "webhook.created", "Webhook", sub.Id.ToString(), $"{sub.Event} -> {sub.Url}", ct);

        return Ok(new WebhookCreatedDto(ToDto(sub), secret));
    }

    [HttpGet]
    public async Task<ActionResult<List<WebhookSummaryDto>>> List(CancellationToken ct)
    {
        var subs = await db.WebhookSubscriptions.Find(FilterDefinition<WebhookSubscription>.Empty)
            .SortByDescending(s => s.CreatedAt).ToListAsync(ct);
        return Ok(subs.Select(ToDto).ToList());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var sub = await db.WebhookSubscriptions.Find(s => s.Id == id).FirstOrDefaultAsync(ct);
        await db.WebhookSubscriptions.DeleteOneAsync(s => s.Id == id, ct);
        await audit.LogAsync(User, "webhook.deleted", "Webhook", id.ToString(), sub?.Event, ct);
        return NoContent();
    }

    private static WebhookSummaryDto ToDto(WebhookSubscription s) => new(s.Id, s.Url, s.Event, s.CreatedAt);
}
