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
    /// <summary>The sale currently open for bidding on OKLO right now, if any - for the "watch the live auction" page.
    /// Open to every signed-in user, like freshness/refresh-now (no data beyond what the catalogue itself already shows).</summary>
    [HttpGet("live-sale")]
    public IActionResult LiveSale([FromServices] OkloLiveSales live)
    {
        var sale = live.CurrentlyOpenSale();
        return Ok(sale is null
            ? new LiveSaleDto(false, null, null, null, null, null)
            : new LiveSaleDto(true, sale.CatalogueId, sale.Year, sale.SaleNo, $"Sale {sale.SaleNo} - {sale.Year}", sale.Catalog.AuctionDate));
    }

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

    /// <summary>
    /// One-time maintenance: re-writes every local sale file that already exists in data/sales, straight from its
    /// stored OKLO snapshot - no OKLO calls (fast, local-only), used to bring the old, now-stale fallback copies in
    /// data/sales up to date with what OKLO has shown since (does NOT turn AutoSync back on, and does not create a
    /// file for any sale that doesn't already have one - see docs/31_OKLO_Live_Data.md: these files stay a frozen
    /// fallback for when OKLO is unreachable, not the live source).
    /// </summary>
    [HttpPost("refresh-local-files")]
    [Authorize(Policy = Policies.ManageDataFiles)]
    public async Task<IActionResult> RefreshLocalFiles([FromServices] Asc.Api.Services.SaleFileStore files, [FromServices] ISaleSnapshotStore snapshots, CancellationToken ct)
    {
        var targets = new List<(int Year, int SaleNo, string Path)>();
        if (Directory.Exists(files.SalesDir))
            foreach (var yearDir in Directory.GetDirectories(files.SalesDir))
                if (int.TryParse(Path.GetFileName(yearDir), out var year))
                    foreach (var file in Directory.GetFiles(yearDir, "*.xlsx"))
                        if (int.TryParse(Path.GetFileNameWithoutExtension(file), out var saleNo))
                            targets.Add((year, saleNo, file));

        var written = new List<string>();
        var noSnapshot = new List<string>();
        var failed = new List<string>();
        foreach (var (year, saleNo, path) in targets.OrderBy(t => t.Year).ThenBy(t => t.SaleNo))
        {
            var label = $"{saleNo}/{year}";
            try
            {
                var snap = await snapshots.LoadAsync(Asc.Api.Services.SaleFileStore.CatalogueIdFor(year, saleNo), ct);
                if (snap is null || snap.Lots.Count == 0) { noSnapshot.Add(label); continue; }
                var rows = snap.Lots.OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.BrokerLotNumber).Select(OkloSaleMapper.MapRow).ToList();
                OkloSaleWriter.Write(path, rows);
                written.Add(label);
            }
            catch (Exception ex) { failed.Add($"{label}: {ex.Message}"); }
        }
        return Ok(new { totalFiles = targets.Count, written = written.Count, noSnapshot, failed });
    }
}

/// <summary>Body of POST /api/oklo/refresh-now: the sales the page is working with (optional).</summary>
public record RefreshNowRequest(List<Guid>? CatalogueIds);

/// <summary>GET /api/oklo/live-sale: the sale open for bidding right now, if any.</summary>
public record LiveSaleDto(bool Live, Guid? CatalogueId, int? Year, int? SaleNo, string? SourceName, DateTime? AuctionDate);
