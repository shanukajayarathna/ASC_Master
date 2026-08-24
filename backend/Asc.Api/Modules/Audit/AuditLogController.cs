using Asc.Api.Data;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Audit;

/// <summary>Read-only view of the audit trail — writes happen inline from the actions being
/// audited (see IAuditLogger), never through this controller.</summary>
[ApiController]
[Route("api/v1/audit-log")]
[Authorize(Policy = Policies.ViewAuditLog)]
public class AuditLogController(MongoContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<AuditLogEntryDto>>> List(
        [FromQuery] int skip = 0, [FromQuery] int take = 50,
        [FromQuery] string? entityType = null, [FromQuery] string? entityId = null, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        skip = Math.Max(skip, 0);

        // entityType/entityId — e.g. Admin Panel's Automated Reports "run history" panel,
        // scoped to one job's Key — narrow to a single entity's trail instead of the global
        // feed. Both optional and independent so a caller can filter by type alone too.
        var filter = Builders<AuditLogEntry>.Filter.Empty;
        if (entityType is not null) filter &= Builders<AuditLogEntry>.Filter.Eq(e => e.EntityType, entityType);
        if (entityId is not null) filter &= Builders<AuditLogEntry>.Filter.Eq(e => e.EntityId, entityId);

        var entries = await db.AuditLogs.Find(filter)
            .SortByDescending(e => e.Timestamp)
            .Skip(skip)
            .Limit(take)
            .ToListAsync(ct);

        return Ok(entries.Select(ToDto).ToList());
    }

    private static AuditLogEntryDto ToDto(AuditLogEntry e) => new(e.Id, e.Timestamp, e.UserEmail, e.Action, e.EntityType, e.EntityId, e.Details);
}
