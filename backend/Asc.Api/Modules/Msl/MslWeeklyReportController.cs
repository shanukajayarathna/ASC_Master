using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Msl;

/// <summary>Serves the Weekly FACT Reports page's "generate from database" option — an
/// alternative to uploading the WES master workbook by hand, for sales already imported
/// into the MSL archive. The CBAC elevation-average TXT stays upload-only (its Orthodox/CTC
/// benchmark split isn't reliably reproducible from lot-level data — see
/// MslWeeklyReportService's own doc comment for what is and isn't verified).</summary>
[ApiController]
[Route("api/v1/msl/weekly-report")]
[Authorize]
public class MslWeeklyReportController(MslWeeklyReportService service) : ControllerBase
{
    [HttpGet("wes")]
    public async Task<ActionResult<WesEquivalentDto>> Wes([FromQuery] int year, [FromQuery] int saleNo, CancellationToken ct)
    {
        var result = await service.BuildAsync(year, saleNo, ct);
        if (result is null)
            return NotFound($"Sale {saleNo} of {year} isn't in the database yet — upload the WES file for this sale manually instead.");
        return result;
    }
}
