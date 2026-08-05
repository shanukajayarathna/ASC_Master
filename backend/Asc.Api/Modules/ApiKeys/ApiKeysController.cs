using System.Security.Claims;
using System.Security.Cryptography;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.ApiKeys;

/// <summary>
/// Admin-only management of machine credentials for external callers (e.g. an n8n workflow).
/// Mirrors AuthController's user-management trio (list/create/delete) — same shape, same
/// Admin-only gate, same "never expose the secret again after creation" principle.
/// </summary>
[ApiController]
[Route("api/v1/api-keys")]
[Authorize(Roles = "Admin")]
public class ApiKeysController(MongoContext db) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<ApiKeyCreatedDto>> Create(CreateApiKeyRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("A name is required.");
        if (dto.Roles.Count == 0 || dto.Roles.Any(r => r is not ("Admin" or "User")))
            return BadRequest("Roles must be a non-empty list of 'Admin' and/or 'User'.");

        var rawKey = $"asc_{Convert.ToHexString(RandomNumberGenerator.GetBytes(32))}";
        var key = new ApiKey
        {
            Name = dto.Name.Trim(),
            KeyHash = ApiKeyHasher.Hash(rawKey),
            KeyPrefix = rawKey[..12],
            Roles = dto.Roles,
            CreatedByUserId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty,
        };
        await db.ApiKeys.InsertOneAsync(key, cancellationToken: ct);

        return Ok(new ApiKeyCreatedDto(ToDto(key), rawKey));
    }

    [HttpGet]
    public async Task<ActionResult<List<ApiKeySummaryDto>>> List(CancellationToken ct)
    {
        var keys = await db.ApiKeys.Find(FilterDefinition<ApiKey>.Empty).SortByDescending(k => k.CreatedAt).ToListAsync(ct);
        return Ok(keys.Select(ToDto).ToList());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await db.ApiKeys.DeleteOneAsync(k => k.Id == id, ct);
        return NoContent();
    }

    private static ApiKeySummaryDto ToDto(ApiKey k) => new(k.Id, k.Name, k.KeyPrefix, k.Roles, k.CreatedAt, k.LastUsedAt);
}
