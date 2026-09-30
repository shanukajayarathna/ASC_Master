namespace Asc.Api.Modules.Oklo;

/// <summary>
/// Settings for the OKLO SmartAuction API (section "Oklo"). Credentials live in
/// dotnet user-secrets / environment, never in appsettings.json — see docs/ and the
/// oklo-smartauction-api memory for the key names.
/// </summary>
public class OkloOptions
{
    /// <summary>Azure B2C ResourceOwner token endpoint (password grant).</summary>
    public string TokenUrl { get; set; } = "";
    /// <summary>API host. The 2022 PDF's smartauctionapimanager.okloapps.com no longer exists.</summary>
    public string BaseUrl { get; set; } = "https://smartauctionreports.okloapps.com";
    public string Scope { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";

    /// <summary>Rows per general-report page. 3000 measured ~10s/page vs ~8s for 50 — big pages win.</summary>
    public int PageSize { get; set; } = 3000;

    /// <summary>Master switch for the background refresh loop. Off by default so a fresh checkout
    /// never rewrites data/sales unasked; manual admin sync endpoints work regardless.</summary>
    public bool AutoSync { get; set; }

    /// <summary>A sale dated within this many days counts as "recent" and is re-pulled often
    /// (out-lot sales and buyer transfers keep changing rows for ~2 weeks after the auction).</summary>
    public int RecentWindowDays { get; set; } = 21;
    /// <summary>How often recent / open / published sales are re-pulled.</summary>
    public int RecentRefreshMinutes { get; set; } = 5;
    /// <summary>How often a sale within a day of its auction date is re-pulled (live auction).</summary>
    public int LiveRefreshMinutes { get; set; } = 2;
    /// <summary>How often older sales are re-checked once they've been imported.</summary>
    public int ArchiveRefreshHours { get; set; } = 24;
    /// <summary>Pause after each archive/back-fill sale, so a long import leaves the machine responsive.</summary>
    // Gate (OkloClient's process-wide one-request-at-a-time cap) already serializes real OKLO usage, so this pause is
    // purely a local courtesy gap between backfill steps, not a throttle on OKLO itself - kept short so the backlog
    // (hundreds of sales, each also taking real time on OKLO's side) actually clears at a reasonable pace.
    public int BackgroundPauseSeconds { get; set; } = 5;
    /// <summary>How often the catalogue list is re-read to notice new sales.</summary>
    public int CatalogListMinutes { get; set; } = 15;
    /// <summary>Earliest auction year the back-fill imports. Defaults to 2024 — what the app had as files
    /// before OKLO; OKLO holds 2022-2023 too (2021 is empty), set 2022 to pull them.</summary>
    public int FirstYear { get; set; } = 2024;

    /// <summary>A sale a person opened earlier and has since left (nobody has asked for it for this many seconds) yields its
    /// load slot to a sale someone is waiting on now, instead of holding it for minutes. It restarts if it is opened again.</summary>
    public int PreemptAfterIdleSeconds { get; set; } = 15;
    /// <summary>A pull is never paused before it has run this long, and never once its first rows have arrived - so a slow OKLO
    /// cannot leave sales endlessly paused and restarted with none finishing. Deliberately short: this only guards against
    /// pausing something a second into its very first request: the idle check above (nobody has touched it in
    /// PreemptAfterIdleSeconds) is what actually establishes "abandoned", and someone clicking through sales in the
    /// Catalogue Manager expects switching away from one to free it up in seconds, not minutes.</summary>
    public int PreemptMinRunSeconds { get; set; } = 20;

    /// <summary>Serve the catalogue pages straight from OKLO (loaded into memory when a sale is opened,
    /// no files involved) instead of from the synced workbooks. Files stay as an analytics cache and
    /// as the fallback when OKLO is unreachable.</summary>
    public bool LiveView { get; set; } = true;
    /// <summary>Rows per page while loading a sale into the live view. Small enough that the first rows
    /// appear in ~5s (a 500-row page measured 4.6s, a 3000-row page ~10s), big enough to be ~11 calls per sale.</summary>
    // OKLO's own database charges a large fixed cost per request (measured ~11-12s, independent of page size) on top of the
    // data itself — 1,000-row pages meant a 12k-lot sale needed ~13 round trips (~4 min); 3,000-row pages need only ~4-5
    // (~2-2.5 min), for the same total data. Kept well under PageSize (3000, the sync client's own default) below OKLO's
    // ignorePaging cutoff and the point where a single page's own transfer time starts dominating.
    public int LivePageSize { get; set; } = 3000;
    /// <summary>How long a loaded sale is served before a background refresh — by how active it is.</summary>
    public int ViewTtlLiveMinutes { get; set; } = 2;
    public int ViewTtlRecentMinutes { get; set; } = 10;
    public int ViewTtlArchiveHours { get; set; } = 720; // 30 days: a finished sale's results are final, re-pull only as a rare correction
    /// <summary>Sales kept in memory at once (least recently used are dropped; they simply reload on demand).</summary>
    public int MaxLiveSales { get; set; } = 8;

    /// <summary>Pull every OKLO sale once in the background and keep its snapshot in the database (newest first,
    /// throttled, background lane) so restarts are instant and reports can read history. On by default with the live view.</summary>
    public bool SnapshotBackfill { get; set; } = true;
    /// <summary>Pause after each backfilled sale, so OKLO and this machine are never hammered.</summary>
    public int BackfillPauseSeconds { get; set; } = 20;

    /// <summary>A sale is force-refreshed (page reload) at most this often, so reloading a page repeatedly never hammers OKLO.</summary>
    public int ForceRefreshMinSeconds { get; set; } = 60;

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(TokenUrl) && !string.IsNullOrWhiteSpace(ClientId) &&
        !string.IsNullOrWhiteSpace(ClientSecret) && !string.IsNullOrWhiteSpace(Username) &&
        !string.IsNullOrWhiteSpace(Password);
}
