using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Knowledge;

public record BylawsClauseDto(string Title, string Text, string? LastVerified, string Caveat);

/// <summary>
/// Read-only access to one section of the CTTA By-Laws reference, so the assistant's "CTTA By-Laws · section" source
/// chip can open the clause it cites. Serves the same canonical file the agents read (docs/ctta-bylaws-knowledge-base.md).
/// </summary>
[ApiController]
[Route("api/v1/knowledge/ctta-bylaws")]
[Authorize]
public class CttaBylawsController(ICttaBylawsService bylaws) : ControllerBase
{
    [HttpGet("section")]
    public ActionResult<BylawsClauseDto> Section([FromQuery] string title)
    {
        var result = bylaws.Lookup(title);
        if (result is null) return NotFound(new { error = "The CTTA By-Laws reference isn't available on this server." });
        var match = Pick(result, title);
        return match is null
            ? NotFound(new { error = $"No by-laws section matches '{title}'." })
            : Ok(new BylawsClauseDto(match.Title, match.Text, result.LastVerified, result.Caveat));
    }

    /// <summary>The section named by <paramref name="title"/> among the ones the lookup matched (case-insensitive); the
    /// key-constants preamble is never returned in its place.</summary>
    public static CttaBylawsSection? Pick(CttaBylawsLookupResult result, string title) =>
        result.MatchedSections.Any(m => string.Equals(m, title, StringComparison.OrdinalIgnoreCase))
            ? result.Sections.FirstOrDefault(s => string.Equals(s.Title, title, StringComparison.OrdinalIgnoreCase))
            : null;
}
