using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Deadlines;

/// <summary>Read-only — deadline rows are written only by DeadlineEngine/DeadlineCheckService,
/// never through this controller (there is nothing to author; see Deadline's doc comment).</summary>
[ApiController]
[Route("api/v1/deadlines")]
[Authorize]
public class DeadlinesController(DeadlineEngine engine) : ControllerBase
{
    [HttpGet("upcoming")]
    public async Task<ActionResult<List<DeadlineDto>>> Upcoming(CancellationToken ct) =>
        Ok((await engine.GetUpcoming(ct)).Select(ToDto).ToList());

    private static DeadlineDto ToDto(Deadline d) => new(
        d.Id, d.Type, d.EntityId, d.EntityLabel, d.DueAt, d.ResponsibleRole, d.Status.ToString(), d.NotifiedEscalationLevel);
}
