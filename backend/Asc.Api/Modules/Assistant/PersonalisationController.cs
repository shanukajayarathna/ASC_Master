using System.Security.Claims;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

public record AssistantPreferencesDto(string MyBroker, bool Personalise);

/// <summary>What the empty screen shows "for you": the reader's first name and their own recent questions.</summary>
public record ForYouDto(string? FirstName, bool Personalise, string MyBroker, IReadOnlyList<string> Recent, int PinCount);

/// <summary>
/// The user's own assistant settings and the small amount of their own history the assistant may use to personalise
/// (their name, the questions they asked recently, how many insights they pinned). Nothing here reads another user's
/// data. Turning personalisation off stops all of it; "clear my history" deletes the user's conversations.
/// </summary>
[ApiController]
[Route("api/v1/assistant")]
[Authorize]
public class PersonalisationController(MongoContext db) : ControllerBase
{
    private Guid UserId => Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    public static async Task<AssistantPreferences> LoadAsync(MongoContext db, Guid userId, CancellationToken ct) =>
        await db.AssistantPreferences.Find(p => p.UserId == userId).FirstOrDefaultAsync(ct) ?? new AssistantPreferences { UserId = userId };

    /// <summary>Null when the settings are acceptable, otherwise the message.</summary>
    public static string? Validate(AssistantPreferencesDto? dto) =>
        dto is null || !AssistantPreferences.Brokers.Contains((dto.MyBroker ?? "").Trim().ToUpperInvariant())
            ? $"myBroker must be one of: {string.Join(", ", AssistantPreferences.Brokers)}."
            : null;

    [HttpGet("preferences")]
    public async Task<ActionResult<AssistantPreferencesDto>> GetPreferences(CancellationToken ct)
    {
        var p = await LoadAsync(db, UserId, ct);
        return Ok(new AssistantPreferencesDto(p.MyBroker, p.Personalise));
    }

    [HttpPut("preferences")]
    public async Task<ActionResult<AssistantPreferencesDto>> PutPreferences(AssistantPreferencesDto dto, CancellationToken ct)
    {
        if (Validate(dto) is { } problem) return BadRequest(new { error = problem });
        var saved = new AssistantPreferences { UserId = UserId, MyBroker = dto.MyBroker.Trim().ToUpperInvariant(), Personalise = dto.Personalise };
        await db.AssistantPreferences.ReplaceOneAsync(p => p.UserId == UserId, saved, new ReplaceOptions { IsUpsert = true }, ct);
        return Ok(new AssistantPreferencesDto(saved.MyBroker, saved.Personalise));
    }

    [HttpGet("for-you")]
    public async Task<ActionResult<ForYouDto>> ForYou(CancellationToken ct)
    {
        var prefs = await LoadAsync(db, UserId, ct);
        var firstName = UserContext.FirstNameOf(User.FindFirstValue(ClaimTypes.Name));
        if (!prefs.Personalise) return Ok(new ForYouDto(null, false, prefs.MyBroker, [], 0));

        var (recent, pins) = await ActivityAsync(db, UserId, User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "", ct);
        return Ok(new ForYouDto(firstName, true, prefs.MyBroker, recent, pins));
    }

    /// <summary>The user's own recent questions worth offering again, and how many insights they pinned.</summary>
    public static async Task<(IReadOnlyList<string> Recent, int Pins)> ActivityAsync(MongoContext db, Guid userId, string ownerId, CancellationToken ct)
    {
        var titles = await db.Conversations.Find(c => c.UserId == userId).SortByDescending(c => c.CreatedAt).Limit(20).ToListAsync(ct);
        var pins = (int)await db.AnalyticsPins.CountDocumentsAsync(p => p.OwnerId == ownerId, cancellationToken: ct);
        return (SmallTalk.WorthRepeating(titles.Select(c => c.Title)), pins);
    }

    /// <summary>Deletes every conversation (and its messages) of the signed-in user. Pins, saved reports and schedules are kept.</summary>
    [HttpDelete("history")]
    public async Task<IActionResult> ClearHistory(CancellationToken ct)
    {
        var ids = await db.Conversations.Find(c => c.UserId == UserId).Project(c => c.Id).ToListAsync(ct);
        if (ids.Count > 0)
        {
            await db.ConversationMessages.DeleteManyAsync(m => ids.Contains(m.ConversationId), ct);
            await db.Conversations.DeleteManyAsync(c => c.UserId == UserId, ct);
        }
        return NoContent();
    }
}
