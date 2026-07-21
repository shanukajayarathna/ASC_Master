using System.Text.RegularExpressions;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Controllers;

/// <summary>
/// Per-lot media — a photo and per-remark-field voice notes — used in the Valuation Centre's
/// focus mode (photograph a sample to compare sharings, dictate the standard/remarks/liquor
/// instead of typing). Stored through <see cref="ILotMediaStore"/>: on disk for now, a
/// database/blob store later, with no controller change. Binaries are sent as raw PUT bodies
/// (the browser posts the captured JPEG / recorded audio blob directly).
/// </summary>
[ApiController]
[Route("api/lots/{lotId:guid}")]
public class LotMediaController(ILotMediaStore media) : ControllerBase
{
    // Same shape the store enforces — validated here too so a bad field is a clean 400.
    private static readonly Regex FieldPattern = new("^[A-Za-z]{2,40}$", RegexOptions.Compiled);

    private const long PhotoMaxBytes = 25_000_000;   // generous — cropped photos are well under 1 MB
    private const long VoiceMaxBytes = 50_000_000;   // a few minutes of opus/aac audio

    [HttpGet("media")]
    public ActionResult<LotMediaManifest> GetManifest(Guid lotId) => Ok(media.GetManifest(lotId));

    // ---- photo ----------------------------------------------------------------------

    [HttpGet("photo")]
    public IActionResult GetPhoto(Guid lotId)
    {
        var hit = media.GetPhoto(lotId);
        return hit is null ? NotFound() : PhysicalFile(hit.Value.Path, hit.Value.ContentType);
    }

    [HttpPut("photo")]
    [RequestSizeLimit(PhotoMaxBytes)]
    public async Task<ActionResult<LotMediaManifest>> PutPhoto(Guid lotId, CancellationToken ct)
    {
        var contentType = Request.ContentType ?? "image/jpeg";
        if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return BadRequest("A lot photo must be an image.");
        await media.SavePhotoAsync(lotId, Request.Body, contentType, ct);
        return Ok(media.GetManifest(lotId));
    }

    [HttpDelete("photo")]
    public IActionResult DeletePhoto(Guid lotId)
    {
        media.DeletePhoto(lotId);
        return NoContent(); // idempotent — deleting a missing photo is still "gone"
    }

    // ---- voice ----------------------------------------------------------------------

    [HttpGet("voice/{field}")]
    public IActionResult GetVoice(Guid lotId, string field)
    {
        if (!FieldPattern.IsMatch(field)) return BadRequest("Invalid voice field.");
        var hit = media.GetVoice(lotId, field);
        // Range processing lets the <audio> element seek within the note.
        return hit is null ? NotFound() : PhysicalFile(hit.Value.Path, hit.Value.ContentType, enableRangeProcessing: true);
    }

    [HttpPut("voice/{field}")]
    [RequestSizeLimit(VoiceMaxBytes)]
    public async Task<ActionResult<LotMediaManifest>> PutVoice(Guid lotId, string field, CancellationToken ct)
    {
        if (!FieldPattern.IsMatch(field)) return BadRequest("Invalid voice field.");
        var contentType = Request.ContentType ?? "audio/webm";
        if (!contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase))
            return BadRequest("A voice note must be audio.");
        await media.SaveVoiceAsync(lotId, field, Request.Body, contentType, ct);
        return Ok(media.GetManifest(lotId));
    }

    [HttpDelete("voice/{field}")]
    public IActionResult DeleteVoice(Guid lotId, string field)
    {
        if (!FieldPattern.IsMatch(field)) return BadRequest("Invalid voice field.");
        media.DeleteVoice(lotId, field);
        return NoContent();
    }
}
