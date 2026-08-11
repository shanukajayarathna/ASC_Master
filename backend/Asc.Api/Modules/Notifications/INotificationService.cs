namespace Asc.Api.Modules.Notifications;

public interface INotificationService
{
    Task NotifyAsync(
        Guid userId, string type, string title, string? body = null, string? actionUrl = null,
        string priority = "normal", string? entityType = null, string? entityId = null, CancellationToken ct = default);

    /// <summary>Fans out to every user currently holding `role` — one Notification row per
    /// matching user, no broadcast/room concept. A role with zero matching users is a no-op,
    /// not an error.</summary>
    Task NotifyUsersInRoleAsync(
        string role, string type, string title, string? body = null, string? actionUrl = null,
        string priority = "normal", string? entityType = null, string? entityId = null, CancellationToken ct = default);

    /// <summary>The external-channel half of this service — hides the delivery mechanism
    /// (currently: fires a "notification.whatsapp" event through IWorkflowService, for an
    /// n8n workflow to actually deliver; no real WhatsApp Business API integration exists
    /// yet) so no agent or business rule ever depends on a workflow engine or a messaging
    /// provider directly.</summary>
    Task SendWhatsAppMessageAsync(string toPhoneNumber, string message, CancellationToken ct = default);
}
