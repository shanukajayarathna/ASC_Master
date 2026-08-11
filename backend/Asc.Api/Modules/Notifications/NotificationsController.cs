using System.Security.Claims;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Notifications;

/// <summary>Every read here is scoped to the calling user's own notifications by identity —
/// not a role gate, since a notification is inherently personal (mirrors the ownership
/// checks Conversation/ApiKey already do, just as the primary access rule instead of a
/// secondary one).</summary>
[ApiController]
[Route("api/v1/notifications")]
[Authorize]
public class NotificationsController(MongoContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<NotificationDto>>> List([FromQuery] bool unreadOnly, [FromQuery] int take, CancellationToken ct)
    {
        var userId = CurrentUserId();
        take = take <= 0 ? 20 : Math.Clamp(take, 1, 100);

        var filter = unreadOnly
            ? Builders<Notification>.Filter.And(
                Builders<Notification>.Filter.Eq(n => n.UserId, userId),
                Builders<Notification>.Filter.Eq(n => n.ReadAt, null))
            : Builders<Notification>.Filter.Eq(n => n.UserId, userId);

        var notifications = await db.Notifications.Find(filter)
            .SortByDescending(n => n.CreatedAt)
            .Limit(take)
            .ToListAsync(ct);

        return Ok(notifications.Select(ToDto).ToList());
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<int>> UnreadCount(CancellationToken ct)
    {
        var userId = CurrentUserId();
        var count = await db.Notifications.CountDocumentsAsync(
            n => n.UserId == userId && n.ReadAt == null, cancellationToken: ct);
        return Ok((int)count);
    }

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        var userId = CurrentUserId();
        await db.Notifications.UpdateOneAsync(
            n => n.Id == id && n.UserId == userId,
            Builders<Notification>.Update.Set(n => n.ReadAt, DateTime.UtcNow), cancellationToken: ct);
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct)
    {
        var userId = CurrentUserId();
        await db.Notifications.UpdateManyAsync(
            n => n.UserId == userId && n.ReadAt == null,
            Builders<Notification>.Update.Set(n => n.ReadAt, DateTime.UtcNow), cancellationToken: ct);
        return NoContent();
    }

    private Guid CurrentUserId() =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    private static NotificationDto ToDto(Notification n) => new(
        n.Id, n.Type, n.Priority, n.Title, n.Body, n.ActionUrl, n.EntityType, n.EntityId, n.CreatedAt, n.ReadAt);
}
