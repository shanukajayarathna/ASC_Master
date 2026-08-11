using Asc.Api.Data;
using Asc.Api.Modules.Workflow;
using MongoDB.Driver;

namespace Asc.Api.Modules.Notifications;

public class NotificationService(MongoContext db, IWorkflowService workflow, ILogger<NotificationService> logger) : INotificationService
{
    private const string WhatsAppEventName = "notification.whatsapp";
    public async Task NotifyAsync(
        Guid userId, string type, string title, string? body = null, string? actionUrl = null,
        string priority = "normal", string? entityType = null, string? entityId = null, CancellationToken ct = default)
    {
        var notification = new Notification
        {
            UserId = userId,
            Type = type,
            Priority = priority,
            Title = title,
            Body = body,
            ActionUrl = actionUrl,
            EntityType = entityType,
            EntityId = entityId,
        };
        await db.Notifications.InsertOneAsync(notification, cancellationToken: ct);
    }

    public async Task NotifyUsersInRoleAsync(
        string role, string type, string title, string? body = null, string? actionUrl = null,
        string priority = "normal", string? entityType = null, string? entityId = null, CancellationToken ct = default)
    {
        var users = await db.Users.Find(u => u.Roles.Contains(role)).ToListAsync(ct);
        if (users.Count == 0) return;

        var notifications = users.Select(u => new Notification
        {
            UserId = u.Id,
            Type = type,
            Priority = priority,
            Title = title,
            Body = body,
            ActionUrl = actionUrl,
            EntityType = entityType,
            EntityId = entityId,
        }).ToList();

        await db.Notifications.InsertManyAsync(notifications, cancellationToken: ct);
    }

    public async Task SendWhatsAppMessageAsync(string toPhoneNumber, string message, CancellationToken ct = default)
    {
        try
        {
            await workflow.TriggerAsync(WhatsAppEventName, new { to = toPhoneNumber, message, sentAt = DateTime.UtcNow }, ct);
            logger.LogInformation("WhatsApp notification triggered: to={MaskedPhone}", Mask(toPhoneNumber));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Same "never take the caller down with it" principle as WebhookSender itself —
            // a missing/unreachable n8n workflow must not fail whatever business action
            // triggered this notification.
            logger.LogWarning(ex, "WhatsApp notification failed: to={MaskedPhone}", Mask(toPhoneNumber));
        }
    }

    /// <summary>Never logs a full phone number or the message body — only enough to
    /// correlate a support report with a log line.</summary>
    private static string Mask(string phoneNumber) =>
        phoneNumber.Length <= 4 ? "***" : $"***{phoneNumber[^4..]}";
}
