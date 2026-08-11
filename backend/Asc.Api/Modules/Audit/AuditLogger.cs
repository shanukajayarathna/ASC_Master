using System.Security.Claims;
using Asc.Api.Data;

namespace Asc.Api.Modules.Audit;

public class AuditLogger(MongoContext db) : IAuditLogger
{
    public async Task LogAsync(ClaimsPrincipal actor, string action, string? entityType = null, string? entityId = null, string? details = null, CancellationToken ct = default)
    {
        var entry = new AuditLogEntry
        {
            UserId = Guid.TryParse(actor.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : null,
            UserEmail = actor.FindFirstValue(ClaimTypes.Email),
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Details = details,
        };
        await db.AuditLogs.InsertOneAsync(entry, cancellationToken: ct);
    }
}
