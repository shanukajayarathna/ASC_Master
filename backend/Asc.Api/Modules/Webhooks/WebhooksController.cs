using System.Security.Cryptography;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Webhooks;

/// <summary>Admin-only management of outbound webhook subscriptions. Same list/create/delete
/// shape and "secret shown once" principle as ApiKeysController.</summary>
[ApiController]
[Route("api/v1/webhooks")]
[Authorize(Roles = "Admin")]
public class WebhooksController(MongoContext db) : ControllerBase
{
    private static readonly string[] KnownEvents = ["catalogue.imported"];

    [HttpGet("events")]
    public ActionResult<string[]> Events() => Ok(KnownEvents);

    [HttpPost]
    public async Task<ActionResult<WebhookCreatedDto>> Create(CreateWebhookRequestDto dto, CancellationToken ct)
    {
        if (!Uri.TryCreate(dto.Url, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            return BadRequest("Url must be a valid absolute http(s) URL.");
        if (string.IsNullOrWhiteSpace(dto.Event)) return BadRequest("Event is required.");

        var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var sub = new WebhookSubscription { Url = dto.Url, Event = dto.Event, Secret = secret };
        await db.WebhookSubscriptions.InsertOneAsync(sub, cancellationToken: ct);

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
        await db.WebhookSubscriptions.DeleteOneAsync(s => s.Id == id, ct);
        return NoContent();
    }

    private static WebhookSummaryDto ToDto(WebhookSubscription s) => new(s.Id, s.Url, s.Event, s.CreatedAt);
}
