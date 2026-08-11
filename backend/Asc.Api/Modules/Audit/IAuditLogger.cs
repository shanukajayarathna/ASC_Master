using System.Security.Claims;

namespace Asc.Api.Modules.Audit;

public interface IAuditLogger
{
    /// <summary>Records one audit entry, attributing it to `actor` (the current
    /// ClaimsPrincipal — the same `User` every controller already has). Fire-and-forget is
    /// deliberately not offered: every call site awaits this, same as the InsertOneAsync
    /// calls it wraps, so a logging failure surfaces the same way a save failure would rather
    /// than being silently swallowed.</summary>
    Task LogAsync(ClaimsPrincipal actor, string action, string? entityType = null, string? entityId = null, string? details = null, CancellationToken ct = default);
}
