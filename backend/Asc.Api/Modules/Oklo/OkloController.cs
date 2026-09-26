using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Oklo;

/// <summary>
/// OKLO live-data controls. Freshness and "refresh now" are open to every signed-in user (using
/// the system is what triggers a refresh, and the sync service itself rate-limits: a sale is
/// only re-pulled if older than two minutes); detailed status and manual sync are Admin-only,
/// like every other data-file operation.
/// </summary>
[ApiController]
[Route("api/oklo")]
[Authorize]
public class OkloController(OkloSyncService sync, OkloSyncBackgroundService background) : ControllerBase
{
    /// <summary>When the newest OKLO data was checked, for an "as of hh:mm" stamp in the UI.</summary>
    [HttpGet("freshness")]
    public IActionResult Freshness() =>
        Ok(new { enabled = sync.IsConfigured && sync.AutoSync, newestCheckedUtc = sync.NewestCheckedUtc });

    /// <summary>Called when a user opens the app: pull stale recent/live sales in the background.</summary>
    [HttpPost("refresh")]
    public IActionResult Refresh()
    {
        if (!sync.IsConfigured || !sync.AutoSync) return Ok(new { started = false });
        background.RequestRefresh();
        return Accepted(new { started = true });
    }

    /// <summary>Monitoring: OKLO reachability (via sale-list age), what the live view holds in memory, how many sales
    /// have a stored snapshot, and what keeps failing. Point an uptime check or dashboard at it.</summary>
    [HttpGet("health")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public IActionResult Health([FromServices] OkloLiveSales live) => Ok(live.Health());

    /// <summary>Called when a page is (re)loaded: re-pull the sales in use from OKLO immediately instead of waiting for the
    /// refresh window (see OkloLiveSales.RefreshNow — rate-limited per sale, finished sales are left alone).</summary>
    [HttpPost("refresh-now")]
    public IActionResult RefreshNow([FromBody] RefreshNowRequest? request, [FromServices] OkloLiveSales live)
    {
        var started = live.RefreshNow(request?.CatalogueIds);
        return Accepted(new { started });
    }

    [HttpGet("status")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public IActionResult Status() => Ok(sync.GetStatus());

    /// <summary>Finish any valuation / lot-media re-links still pending from the move to OKLO's stable lot
    /// ids (loads each affected sale live, so it can take a few minutes per sale).</summary>
    [HttpPost("migrate-valuations")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public async Task<IActionResult> MigrateValuations(CancellationToken ct)
    {
        if (!sync.IsConfigured) return BadRequest("OKLO credentials are not configured (Oklo:* settings).");
        return Ok(new { migratedSales = await sync.MigratePendingAsync(ct) });
    }

    /// <summary>Pull one sale now, by year and number (e.g. 2026 / 37), regardless of AutoSync.</summary>
    [HttpPost("sync/{year:int}/{saleNo:int}")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public async Task<IActionResult> SyncOne(int year, int saleNo, CancellationToken ct)
    {
        if (!sync.IsConfigured) return BadRequest("OKLO credentials are not configured (Oklo:* settings).");
        var catalogs = await sync.RefreshCatalogListAsync(ct);
        var match = catalogs
            .Where(c => sync.Identify(c) is { } id && id.Year == year && id.SaleNo == saleNo)
            .OrderByDescending(c => c.Id).FirstOrDefault();
        if (match is null) return NotFound($"OKLO has no sale {saleNo}/{year}.");
        return Ok(await sync.SyncCatalogAsync(match, ct));
    }
}

/// <summary>Body of POST /api/oklo/refresh-now: the sales the page is working with (optional).</summary>
public record RefreshNowRequest(List<Guid>? CatalogueIds);
