using System.Security.Claims;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.AdminAssets;

/// <summary>
/// Admin-uploadable "system files" — report templates and the export letterhead logo that
/// otherwise only ever change via a code deploy (templates ship in the frontend's public/
/// folder; the logo ships in data/branding, already hand-drop-only per data/README.md).
/// Reads are open to any signed-in user, since every report-generating page needs to know
/// the current file; uploading or reverting a slot is gated to Admin via the same
/// ManageDataFiles policy CataloguesController's sale-file import uses — this is the same
/// job (replacing one of the system's source files) applied to a different kind of file.
/// </summary>
[ApiController]
[Authorize]
public class AdminAssetsController(IAdminAssetStore store, IAuditLogger audit) : ControllerBase
{
    private const long MaxUploadBytes = 20_000_000;

    /// <summary>Full status (size, override state, uploader) for every known slot — the
    /// admin panel's file manager list.</summary>
    [HttpGet("api/v1/admin/assets")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public ActionResult<List<AdminAssetStatus>> List() => Ok(store.ListStatus().ToList());

    /// <summary>Just the ids currently overridden — cheap enough for a report-generation run
    /// to call once up front and skip probing slots that have no override at all.</summary>
    [HttpGet("api/v1/assets/overrides")]
    public ActionResult<List<string>> Overrides() => Ok(store.OverrideIds().ToList());

    /// <summary>Serves the current override for a slot, or 404 when the slot has none (the
    /// caller falls back to its own bundled default in that case — see loadTemplate in
    /// frontend/src/lib/weeklyFactReport.ts).</summary>
    [HttpGet("api/v1/assets/{slotId}")]
    public IActionResult GetCurrent(string slotId)
    {
        var hit = store.Get(slotId);
        return hit is null ? NotFound() : PhysicalFile(hit.Value.Path, hit.Value.ContentType);
    }

    [HttpPost("api/v1/admin/assets/{slotId}")]
    [RequestSizeLimit(MaxUploadBytes)]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public async Task<ActionResult<AdminAssetStatus>> Upload(string slotId, IFormFile file, CancellationToken ct)
    {
        var slot = AdminAssetCatalog.Find(slotId);
        if (slot is null) return NotFound($"Unknown asset slot '{slotId}'.");
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");

        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!slot.AllowedExtensions.Contains(ext))
            return BadRequest($"{slot.Label} expects a .{slot.AllowedExtensions[0]} file.");

        var uploadedBy = User.FindFirstValue(ClaimTypes.Email) ?? "unknown";
        await using var stream = file.OpenReadStream();
        var status = await store.SaveAsync(slotId, stream, uploadedBy, ct);

        await audit.LogAsync(User, "admin_asset.uploaded", "AdminAsset", slotId, $"{slot.Group} — {slot.Label} ({file.FileName}, {file.Length:N0} bytes)", ct);
        return Ok(status);
    }

    [HttpDelete("api/v1/admin/assets/{slotId}")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public async Task<IActionResult> Revert(string slotId, CancellationToken ct)
    {
        var slot = AdminAssetCatalog.Find(slotId);
        if (slot is null) return NotFound();

        var removed = store.Revert(slotId);
        if (removed) await audit.LogAsync(User, "admin_asset.reverted", "AdminAsset", slotId, $"{slot.Group} — {slot.Label}", ct);
        return NoContent();
    }
}
