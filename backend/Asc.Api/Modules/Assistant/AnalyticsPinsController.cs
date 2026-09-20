using System.Security.Claims;
using Asc.Api.Data;
using Asc.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

/// <summary>An insight a person pinned in the Analytics workspace: a chart the agent built, or a written answer. The
/// chart is kept as its spec JSON (the same asc-chart JSON the chat renders), so the board can redraw it later.</summary>
public class AnalyticsPin
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string OwnerId { get; set; } = "";

    /// <summary>Stable id of the content (the client hashes it), so pinning the same thing twice is a no-op.</summary>
    public string ContentKey { get; set; } = "";

    /// <summary>chart | answer</summary>
    public string Kind { get; set; } = "";

    public string Title { get; set; } = "";
    public string? ChartJson { get; set; }
    public string? Text { get; set; }
    public DateTime PinnedAt { get; set; } = DateTime.UtcNow;
}

public record AnalyticsPinDto(Guid Id, string Key, string Kind, string Title, string? ChartJson, string? Text, DateTime PinnedAt);

public record CreatePinRequest(string Key, string Kind, string Title, string? ChartJson, string? Text);

public record CreatePinResult(string Status, AnalyticsPinDto? Pin);

/// <summary>
/// The pinned-insights board of the Analytics workspace, stored per user so it follows them between devices. Everyone
/// sees only their own pins. A board holds at most 12; pinning past that is refused rather than silently dropping the
/// oldest.
/// </summary>
[ApiController]
[Route("api/v1/assistant/pins")]
[Authorize]
public class AnalyticsPinsController(MongoContext db) : ControllerBase
{
    public const int MaxPins = 12;
    public const int MaxJsonChars = 60_000;
    public const int MaxTextChars = 2_000;

    private string OwnerId => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

    /// <summary>Null when the pin can be stored, otherwise the message to return.</summary>
    public static string? Validate(CreatePinRequest? r)
    {
        if (r is null || string.IsNullOrWhiteSpace(r.Key) || r.Key.Length > 100) return "A pin needs a key.";
        if (r.Kind is not ("chart" or "answer")) return "kind must be chart or answer.";
        if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Length > 300) return "A pin needs a title of up to 300 characters.";
        if (r.Kind == "chart" && (string.IsNullOrWhiteSpace(r.ChartJson) || r.ChartJson.Length > MaxJsonChars)) return "A chart pin needs its chart (up to 60,000 characters).";
        if (r.Kind == "answer" && (string.IsNullOrWhiteSpace(r.Text) || r.Text.Length > MaxTextChars)) return "An answer pin needs its text (up to 2,000 characters).";
        return null;
    }

    [HttpGet]
    public async Task<ActionResult<List<AnalyticsPinDto>>> Mine(CancellationToken ct)
    {
        var pins = await db.AnalyticsPins.Find(p => p.OwnerId == OwnerId).SortByDescending(p => p.PinnedAt).ToListAsync(ct);
        return Ok(pins.Select(ToDto).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<CreatePinResult>> Pin(CreatePinRequest request, CancellationToken ct)
    {
        if (Validate(request) is { } problem) return BadRequest(new { error = problem });

        var existing = await db.AnalyticsPins.Find(p => p.OwnerId == OwnerId && p.ContentKey == request.Key).FirstOrDefaultAsync(ct);
        if (existing is not null) return Ok(new CreatePinResult("exists", ToDto(existing)));
        if (await db.AnalyticsPins.CountDocumentsAsync(p => p.OwnerId == OwnerId, cancellationToken: ct) >= MaxPins)
            return Ok(new CreatePinResult("full", null));

        var pin = new AnalyticsPin
        {
            OwnerId = OwnerId, ContentKey = request.Key, Kind = request.Kind, Title = request.Title.Trim(),
            ChartJson = request.Kind == "chart" ? request.ChartJson : null,
            Text = request.Kind == "answer" ? request.Text : null,
        };
        await db.AnalyticsPins.InsertOneAsync(pin, cancellationToken: ct);
        return Ok(new CreatePinResult("added", ToDto(pin)));
    }

    /// <summary>Only ever removes the caller's own pin.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Unpin(Guid id, CancellationToken ct)
    {
        await db.AnalyticsPins.DeleteOneAsync(p => p.Id == id && p.OwnerId == OwnerId, ct);
        return NoContent();
    }

    public static AnalyticsPinDto ToDto(AnalyticsPin p) => new(p.Id, p.ContentKey, p.Kind, p.Title, p.ChartJson, p.Text, p.PinnedAt);
}
