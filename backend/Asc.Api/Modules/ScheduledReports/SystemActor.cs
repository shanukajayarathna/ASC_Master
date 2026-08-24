using System.Security.Claims;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// IAuditLogger.LogAsync takes the ClaimsPrincipal off the current HTTP request — every
/// existing call site is a controller action, which always has one. A background job has no
/// request and no signed-in user, so it logs as this fixed synthetic actor instead (UserId
/// stays null since NameIdentifier is never set; UserEmail reads "system" in the Admin Panel's
/// audit log the same way a real user's email would).
/// </summary>
public static class SystemActor
{
    public static readonly ClaimsPrincipal ClaimsPrincipal = new(
        new ClaimsIdentity([new Claim(ClaimTypes.Email, "system")], authenticationType: "System"));
}
