using System.Collections.Concurrent;
using System.Text.Json;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.Extensions.Options;

namespace Asc.Api.Modules.Oklo;

/// <summary>A sale OKLO knows about, mapped to the app's (year, sale number) identity.</summary>
public sealed record LiveSaleRef(int Year, int SaleNo, OkloCatalog Catalog)
{
    public Guid CatalogueId { get; } = SaleFileStore.CatalogueIdFor(Year, SaleNo);
}

/// <summary>What a reader gets: the lots loaded so far, and whether that is the whole sale.</summary>
public sealed record LiveSnapshot(
    Catalogue Catalogue, IReadOnlyList<Lot> Lots, int Total, bool Complete, DateTime? FetchedAtUtc, bool Refreshing, string? Error);

internal sealed class LiveSaleState(Catalogue? catalogue, Lot[] lots, int total, bool complete, DateTime? fetchedAtUtc)
{
    public static readonly LiveSaleState Empty = new(null, [], 0, false, null);
    public Catalogue? Catalogue { get; } = catalogue;
    public Lot[] Lots { get; } = lots;
    public int Total { get; } = total;
    public bool Complete { get; } = complete;
    public DateTime? FetchedAtUtc { get; } = fetchedAtUtc;
    private Dictionary<Guid, Lot>? _byId;
    /// <summary>Built on first use; lot ids are unique within a sale (repeats are suffixed by BuildSale).</summary>
    public Dictionary<Guid, Lot> ById() => _byId ??= Lots.ToDictionary(l => l.Id);
}

/// <summary>One sale held in memory. Its published state is replaced wholesale, so readers never lock.</summary>
public sealed class LiveSale(LiveSaleRef sale)
{
    public LiveSaleRef Ref { get; } = sale;
    internal volatile LiveSaleState State = LiveSaleState.Empty;
    public volatile bool Loading;
    public volatile string? Error;
    internal long TouchedTicks = DateTime.UtcNow.Ticks;
    /// <summary>Someone is waiting on this sale: its OKLO requests use the priority lane, not the background one.</summary>
    public volatile bool UserWaiting;
    /// <summary>One of the two newest active sales (kept warm): refreshed through its own slot.</summary>
    public volatile bool IsHot;
    /// <summary>The next pull ignores the refresh window (and any fresh-enough stored snapshot): someone asked for the latest.</summary>
    public volatile bool ForceNext;
    internal readonly object Gate = new();
    internal Task? LoadTask;
    /// <summary>Lets a newer request pause this sale's pull (see OkloLiveSales.MakeRoomFor).</summary>
    internal CancellationTokenSource? Cts;
    /// <summary>The pull has a slot and is running (not just queued), and in which lane.</summary>
    internal volatile bool Running;
    internal volatile bool InUserLane;
    internal long StartedTicks;

    public LiveSnapshot? Snapshot()
    {
        var st = State;
        return st.Catalogue is null ? null : new LiveSnapshot(st.Catalogue, st.Lots, st.Total, st.Complete, st.FetchedAtUtc, Loading, Error);
    }
}

/// <summary>
/// The live view of OKLO sales: a sale is fetched page by page into memory when someone opens it
/// (first rows in ~5s, the whole sale in about a minute), served from memory, and refreshed in the
/// background by how active it is — no files involved. Rows are built through the same
/// SaleFileStore.BuildSale as the file path, so ids, valuations and classification are identical.
/// Filtering stays local to the loaded rows: OKLO's own filters are per-sale, 4-12s per call, ignore
/// grade/category, and have no text search, so they can't drive an interactive filter panel.
/// </summary>
public class OkloLiveSales(IOkloFeed feed, SaleFileStore builder, IOptions<OkloOptions> options, ILogger<OkloLiveSales> log, ISaleSnapshotStore? snapshots = null)
{
    private readonly ISaleSnapshotStore _snap = snapshots ?? NullSaleSnapshotStore.Instance;
    private readonly ConcurrentDictionary<Guid, DateTime> _snapshotAges = new();
    private readonly ConcurrentDictionary<Guid, DateTime> _backfillFailures = new();
    /// <summary>How many sales may be pulling from OKLO at once: two for sales a person is waiting on, one for everything
    /// else (background refreshes, index building, the valuation re-link). Without this cap a burst of refreshes and
    /// sweeps put eight sales in flight together, all sharing the same four OKLO request slots - so none of them finished.</summary>
    /// <summary>How many sales a person opened may be actively loading (queued for their turn at OKLO, see
    /// OkloClient's Gate) at once - one, so opening a second sale waits for the first rather than both racing OKLO
    /// side by side.</summary>
    private readonly SemaphoreSlim _userLoads = new(1);
    private readonly SemaphoreSlim _backgroundLoads = new(1);
    /// <summary>The two newest active sales have a slot of their own: their refresh must never queue behind housekeeping
    /// (the valuation re-link, index building, refreshes of older sales) that can hold the background slot for many minutes
    /// when OKLO is slow — which left the newest sale unrefreshed for over 20 minutes.</summary>
    private readonly SemaphoreSlim _hotLoads = new(1);
    private readonly object _snapIndexGate = new();
    private bool _snapIndexLoaded;
    /// <summary>A listing already in flight past the 20s wait below — so a slow listing isn't
    /// re-launched by every caller that comes in while it's still running.</summary>
    private Task<IReadOnlyDictionary<Guid, DateTime>>? _snapIndexLoadTask;

    private static readonly TimeSpan SriLankaOffset = TimeSpan.FromMinutes(330);
    private static readonly TimeSpan DirectoryTtl = TimeSpan.FromMinutes(2);

    private readonly OkloOptions _o = options.Value;
    private readonly object _gate = new();
    private readonly Dictionary<Guid, LiveSale> _sales = new();
    private readonly ConcurrentDictionary<int, int> _counts = new();
    private IReadOnlyDictionary<Guid, LiveSaleRef> _byId = new Dictionary<Guid, LiveSaleRef>();
    private IReadOnlyList<LiveSaleRef> _dir = [];
    private DateTime _dirAtUtc = DateTime.MinValue;
    private DateTime _dirTriedUtc = DateTime.MinValue;
    private Task? _dirTask;
    private int _dirFailures;
    private bool _countsLoaded;

    public bool Enabled => _o.LiveView && feed.IsConfigured;

    // ---- directory: which sales exist ------------------------------------------------------

    /// <summary>Every OKLO sale (2024+ by default), cached; refreshed in the background when stale.</summary>
    public IReadOnlyList<LiveSaleRef> Directory
    {
        get
        {
            if (Enabled) LoadDirectoryFromDisk();
            // After a failed refresh the retry gap doubles (20s, 40s, ... up to 5 minutes) so a struggling OKLO is not asked again and again.
            var retryGap = TimeSpan.FromSeconds(Math.Min(300, 20 * Math.Pow(2, Math.Min(_dirFailures, 4))));
            if (Enabled && DateTime.UtcNow - _dirAtUtc > DirectoryTtl && DateTime.UtcNow - _dirTriedUtc > retryGap)
                _ = RefreshDirectoryAsync();
            return _dir;
        }
    }

    public Task RefreshDirectoryAsync()
    {
        lock (_gate)
        {
            if (_dirTask is { IsCompleted: false }) return _dirTask;
            _dirTriedUtc = DateTime.UtcNow;
            return _dirTask = LoadDirectoryAsync();
        }
    }

    private async Task LoadDirectoryAsync()
    {
        try
        {
            // Bounded: the sale list is small but OKLO can be slow; a stuck call must not hold the list hostage.
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
            var catalogs = await feed.ListCatalogsAsync(cts.Token);
            SetDirectory(catalogs);
            _dirAtUtc = DateTime.UtcNow;
            _dirFailures = 0;
            SaveDirectory(catalogs);
        }
        catch (Exception ex)
        {
            _dirFailures++;
            log.LogWarning("OKLO sale directory refresh failed: {Message}", ex.Message);
        }
    }

    private void SetDirectory(IEnumerable<OkloCatalog> catalogs)
    {
        var refs = catalogs
            .Select(c => (Cat: c, Id: OkloSaleMapper.Identify(c, _o.FirstYear)))
            .Where(x => x.Id is not null)
            .GroupBy(x => x.Id!.Value)
            .Select(g => g.OrderByDescending(x => x.Cat.Id).First())
            .Select(x => new LiveSaleRef(x.Id!.Value.Year, x.Id.Value.SaleNo, x.Cat))
            .ToList();
        _byId = refs.ToDictionary(r => r.CatalogueId);
        _dir = refs;
    }

    // The sale list (ids, numbers, dates, status — no lot data) is remembered on disk, so the app lists every
    // OKLO sale the moment it starts instead of waiting on a slow OKLO call; the live refresh then updates it.
    private string DirectoryPath => Path.GetFullPath(Path.Combine(builder.SalesDir, "..", "oklo", "directory.json"));

    private void LoadDirectoryFromDisk()
    {
        if (_dir.Count > 0) return;
        try
        {
            if (File.Exists(DirectoryPath))
                SetDirectory(JsonSerializer.Deserialize<List<OkloCatalog>>(File.ReadAllText(DirectoryPath)) ?? []);
        }
        catch { /* a missing or corrupt cache just means waiting for OKLO */ }
    }

    private void SaveDirectory(List<OkloCatalog> catalogs)
    {
        try
        {
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(DirectoryPath)!);
            File.WriteAllText(DirectoryPath, JsonSerializer.Serialize(catalogs));
        }
        catch { /* best effort */ }
    }

    /// <summary>True while any sale is being pulled from OKLO for the live view — background work (the file
    /// sync) steps aside so a page someone is waiting on gets OKLO's attention first.</summary>
    public bool IsBusy
    {
        get { lock (_gate) return _sales.Values.Any(s => s.Loading); }
    }

    public LiveSaleRef? Find(Guid catalogueId) => _byId.GetValueOrDefault(catalogueId);

    /// <summary>The sale currently accepting bids on OKLO right now (StatusId 3, "Open" — see OkloClient's status list),
    /// if any. Distinct from the "Live" TTL tier above, which is date-based only and would also match a sale that
    /// happened today but has already closed.</summary>
    public LiveSaleRef? CurrentlyOpenSale() =>
        Directory.Where(r => r.Catalog.StatusId == 3).OrderByDescending(r => r.Catalog.AuctionDate).FirstOrDefault();

    /// <summary>True when the id is an OKLO sale served live. Waits (bounded) for the very first
    /// directory load, so the first request after startup isn't wrongly treated as "not live".</summary>
    public async Task<bool> IsLiveAsync(Guid catalogueId)
    {
        if (!Enabled) return false;
        LoadDirectoryFromDisk();
        if (_dir.Count == 0) await Task.WhenAny(RefreshDirectoryAsync(), Task.Delay(TimeSpan.FromSeconds(20)));
        return Find(catalogueId) is not null;
    }

    // ---- lot counts for the sale list (a tiny probe per sale, remembered) --------------------

    private string CountsPath => Path.GetFullPath(Path.Combine(builder.SalesDir, "..", "oklo", "counts.json"));

    public int? KnownCount(LiveSaleRef r)
    {
        EnsureCountsLoaded();
        return _counts.TryGetValue(r.Catalog.Id, out var n) ? n : null;
    }

    private void EnsureCountsLoaded()
    {
        if (_countsLoaded) return;
        _countsLoaded = true;
        try
        {
            if (File.Exists(CountsPath))
                foreach (var (k, v) in JsonSerializer.Deserialize<Dictionary<int, int>>(File.ReadAllText(CountsPath)) ?? new())
                    _counts[k] = v;
        }
        catch { /* counts are a display nicety */ }
    }

    private void SaveCounts()
    {
        try
        {
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(CountsPath)!);
            File.WriteAllText(CountsPath, JsonSerializer.Serialize(_counts.ToDictionary(kv => kv.Key, kv => kv.Value)));
        }
        catch { /* best effort */ }
    }

    /// <summary>A snapshot of the live view's health for monitoring: is OKLO answering, how old is the sale list,
    /// what is in memory, what is stored, what keeps failing.</summary>
    public object Health()
    {
        var (count, oldest) = SnapshotSummary();
        var now = DateTime.UtcNow;
        return new
        {
            enabled = Enabled,
            directorySales = _dir.Count,
            directoryAgeSeconds = _dirAtUtc == DateTime.MinValue ? (int?)null : (int)(now - _dirAtUtc).TotalSeconds,
            inMemory = AllLoaded().Select(s => new
            {
                sale = $"{s.Ref.SaleNo}/{s.Ref.Year}", loading = s.Loading, complete = s.State.Complete,
                lots = s.State.Lots.Length, pulledUtc = s.State.FetchedAtUtc, error = s.Error,
            }),
            snapshots = new { stored = count, of = _dir.Count, oldestPullUtc = oldest },
            backfillFailures = _backfillFailures.Count(kv => now - kv.Value < TimeSpan.FromMinutes(30)),
        };
    }

    /// <summary>One background step: keep the directory fresh, keep the newest live/recent sales loaded
    /// and current, and probe one sale's size if any is unknown. Returns how long to wait before the next.</summary>
    public async Task<TimeSpan> WarmStepAsync(CancellationToken ct)
    {
        if (!Enabled) return TimeSpan.FromMinutes(1);
        if (_dir.Count == 0 || DateTime.UtcNow - _dirAtUtc > DirectoryTtl) await RefreshDirectoryAsync();
        if (_dirAtUtc != DateTime.MinValue && DateTime.UtcNow - _dirAtUtc > TimeSpan.FromMinutes(30))
            log.LogWarning("OKLO sale list is {Minutes:0} minutes old — OKLO may be unreachable", (DateTime.UtcNow - _dirAtUtc).TotalMinutes);
        var now = DateTime.UtcNow;
        var hot = _dir.Where(r => TierOf(r) != Activity.Archive).OrderByDescending(r => r.Catalog.AuctionDate).Take(2).ToList();
        foreach (var r in hot)
        {
            var s = GetOrCreate(r);
            s.IsHot = true;
            EnsureFresh(s);
        }

        EnsureCountsLoaded();
        // Sizes for the sale list: a few at a time, newest first, only while nothing is being opened.
        var unknown = _dir.OrderByDescending(r => r.Catalog.AuctionDate).Where(r => !_counts.ContainsKey(r.Catalog.Id)).Take(3).ToList();
        if (unknown.Count > 0 && !IsBusy)
        {
            await Task.WhenAll(unknown.Select(async u =>
            {
                try
                {
                    var probe = await feed.GetGeneralReportPageAsync(u.Catalog.Id, 1, 1, ct, background: true);
                    _counts[u.Catalog.Id] = probe.TotalItems;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogDebug("OKLO size probe of {Id} failed: {Message}", u.Catalog.Id, ex.Message); // retried next step
                }
            }));
            SaveCounts();
            return TimeSpan.FromSeconds(3);
        }
        return TimeSpan.FromSeconds(30);
    }

    // ---- loading a sale ---------------------------------------------------------------------

    private enum Activity { Live, Recent, Archive }

    /// <summary>Live, open/published or recent — the sales worth loading on behalf of a background caller.</summary>
    public bool IsActive(LiveSaleRef r) => TierOf(r) != Activity.Archive;

    private Activity TierOf(LiveSaleRef r)
    {
        var today = (DateTime.UtcNow + SriLankaOffset).Date;
        var date = r.Catalog.AuctionDate?.Date ?? DateTime.MinValue;
        if (Math.Abs((date - today).TotalDays) <= 1) return Activity.Live;
        if (r.Catalog.StatusId is 3 or 4 || (today - date).TotalDays <= _o.RecentWindowDays) return Activity.Recent;
        return Activity.Archive;
    }

    private TimeSpan Ttl(LiveSaleRef r) => TierOf(r) switch
    {
        Activity.Live => TimeSpan.FromMinutes(_o.ViewTtlLiveMinutes),
        Activity.Recent => TimeSpan.FromMinutes(_o.ViewTtlRecentMinutes),
        _ => TimeSpan.FromHours(_o.ViewTtlArchiveHours),
    };

    public LiveSale GetOrCreate(LiveSaleRef r)
    {
        lock (_gate)
        {
            if (!_sales.TryGetValue(r.CatalogueId, out var s))
            {
                _sales[r.CatalogueId] = s = new LiveSale(r);
                EvictIfNeeded(s);
            }
            Interlocked.Exchange(ref s.TouchedTicks, DateTime.UtcNow.Ticks);
            return s;
        }
    }

    /// <summary>The sale if it is already in memory (never starts a load).</summary>
    public LiveSale? Loaded(Guid catalogueId)
    {
        lock (_gate) return _sales.GetValueOrDefault(catalogueId);
    }

    /// <summary>Every sale currently in memory — for lot-id lookups, which must not trigger loads.</summary>
    public IReadOnlyList<LiveSale> AllLoaded()
    {
        lock (_gate) return _sales.Values.ToList();
    }

    private void EvictIfNeeded(LiveSale keep)
    {
        while (_sales.Count > Math.Max(1, _o.MaxLiveSales))
        {
            var victim = _sales.Values.Where(s => s != keep && !s.Loading).OrderBy(s => Interlocked.Read(ref s.TouchedTicks)).FirstOrDefault();
            if (victim is null) return;
            _sales.Remove(victim.Ref.CatalogueId);
        }
    }

    /// <summary>Starts a (re)load if the sale isn't loaded, or is older than its TTL. Never blocks.</summary>
    public void EnsureFresh(LiveSale s)
    {
        if (s.Loading) return;
        var st = s.State;
        var stale = !st.Complete || st.FetchedAtUtc is null || DateTime.UtcNow - st.FetchedAtUtc > Ttl(s.Ref);
        // A failed load isn't retried in a tight loop: wait a little before the next attempt.
        // Measured against StartedTicks (set when a load attempt actually begins, StartLoad
        // below) — NOT TouchedTicks, which GetOrCreate resets on every call just before this
        // runs, so comparing against it made "elapsed since last touch" always ~0 and this
        // throttle never let a failed sale retry at all, from any caller.
        if (stale && s.Error is not null && st.Catalogue is null && DateTime.UtcNow.Ticks - Interlocked.Read(ref s.StartedTicks) < TimeSpan.FromSeconds(3).Ticks) return;
        if (stale) StartLoad(s);
    }

    private void StartLoad(LiveSale s)
    {
        lock (s.Gate)
        {
            if (s.Loading) return;
            s.Loading = true;
            s.Error = null;
            s.LoadTask = Task.Run(() => LoadAsync(s));
        }
    }

    private async Task LoadAsync(LiveSale s)
    {
        // Queued (Loading stays true) until a slot of the right kind is free.
        var userLane = s.UserWaiting;
        var slot = userLane ? _userLoads : s.IsHot ? _hotLoads : _backgroundLoads;
        await slot.WaitAsync();
        try
        {
            // A sale that queued for a slot and was abandoned meanwhile (its page moved on to another sale) is dropped rather
            // than pulled for nobody; it starts again the next time someone opens it.
            if (userLane && !s.IsHot && Idle(s) && s.State.Catalogue is null)
            {
                s.Loading = false; s.UserWaiting = false; s.ForceNext = false;
                return;
            }
            var cts = new CancellationTokenSource();
            s.Cts = cts;
            s.InUserLane = userLane;
            Interlocked.Exchange(ref s.StartedTicks, DateTime.UtcNow.Ticks);
            s.Running = true;
            try { await LoadCoreAsync(s, cts.Token); }
            finally { s.Running = false; s.InUserLane = false; }
        }
        finally { slot.Release(); }
    }

    private bool Idle(LiveSale s) =>
        DateTime.UtcNow.Ticks - Interlocked.Read(ref s.TouchedTicks) > TimeSpan.FromSeconds(Math.Max(0, _o.PreemptAfterIdleSeconds)).Ticks;

    /// <summary>A person is waiting on <paramref name="wanted"/> and it has not produced a single row yet: pause whatever is
    /// in its way, so a background/hot-lane refresh of a sale nobody is looking at right now - or another person's sale they
    /// have since walked away from - never leaves it stuck. Runs whether <paramref name="wanted"/> is still queued for its
    /// own lane (see OkloClient's Gate, its one shared OKLO connection) or has already reached that lane and is now merely
    /// waiting its turn at the Gate behind one of those slower background pulls - either way it is not yet getting
    /// anywhere, which is exactly the "still says loading" complaint this exists to fix. Stops once it has its first rows
    /// (progress is now visible, and it's fair game to queue like anything else for the rest of its own pages). What a
    /// paused sale had already loaded stays available either way; a background/hot refresh simply retries next time.</summary>
    private void MakeRoomFor(LiveSale wanted)
    {
        if (!wanted.Loading || wanted.State.Catalogue is not null) return;
        // wanted already holds its own lane slot (Running + InUserLane): the only thing left in its way is the shared Gate,
        // so pausing a background/hot pull holding it is always worth trying. Otherwise wanted is still queued FOR that
        // lane slot itself - pausing an unrelated background/hot pull wouldn't free that slot, so it only helps when the
        // lane is actually free (about to hand it straight to wanted); when a rival occupies it, only that rival (if
        // genuinely abandoned) is worth pausing.
        var holdsOwnLane = wanted.Running && wanted.InUserLane;
        if (wanted.Running && !holdsOwnLane) return; // running in some other lane itself - not this mechanism's concern
        var victim = (holdsOwnLane || _userLoads.CurrentCount > 0
                ? AllLoaded().Where(v => v != wanted && v.Running && !v.InUserLane)
                    .OrderBy(v => Interlocked.Read(ref v.TouchedTicks)).FirstOrDefault()
                : null)
            ?? (holdsOwnLane ? null : AllLoaded().Where(v => v != wanted && v.Running && v.InUserLane && !v.IsHot && Idle(v)
                    && v.State.Catalogue is null   // nothing has arrived yet: pausing loses nothing
                    && DateTime.UtcNow.Ticks - Interlocked.Read(ref v.StartedTicks) > TimeSpan.FromSeconds(Math.Max(0, _o.PreemptMinRunSeconds)).Ticks)
                .OrderBy(v => Interlocked.Read(ref v.TouchedTicks)).FirstOrDefault());
        if (victim is null) return;
        log.LogInformation("OKLO sale {Sale}/{Year} paused so {Wanted}/{WantedYear}, which someone is waiting on, can load",
            victim.Ref.SaleNo, victim.Ref.Year, wanted.Ref.SaleNo, wanted.Ref.Year);
        victim.Cts?.Cancel();
    }

    private async Task LoadCoreAsync(LiveSale s, CancellationToken ct)
    {
        var r = s.Ref;
        var pageSize = Math.Max(100, _o.LivePageSize);
        // A refresh of a complete sale builds off to the side and swaps at the end, so readers
        // never see a half-updated sale; a first load publishes rows as they arrive.
        try
        {
            // A sale that was pulled before (this run or an earlier one) is served from its stored snapshot at
            // once; OKLO is only asked again if that snapshot is older than the sale's refresh window.
            if (!s.State.Complete && await TryLoadSnapshotAsync(s))
            {
                s.Error = null;
                if (!s.ForceNext && s.State.FetchedAtUtc is { } pulled && DateTime.UtcNow - pulled <= Ttl(r)) return;
            }
            var progressive = !s.State.Complete;
            var first = await feed.GetGeneralReportPageAsync(r.Catalog.Id, 1, pageSize, ct, background: !s.UserWaiting);
            var total = first.TotalItems;
            _counts[r.Catalog.Id] = total;
            var lots = new List<OkloLot>(Math.Max(total, first.Rows.Count));
            lots.AddRange(first.Rows);
            var pages = total == 0 ? 1 : (int)Math.Ceiling(total / (double)pageSize);
            if (progressive && pages > 1) Publish(s, lots.ToArray(), total, complete: false);

            if (pages > 1)
            {
                var arrived = new Dictionary<int, List<OkloLot>>();
                var next = 2;
                var publishLock = new object();
                using var gate = new SemaphoreSlim(2);
                await Task.WhenAll(Enumerable.Range(2, pages - 1).Select(async page =>
                {
                    await gate.WaitAsync();
                    try
                    {
                        var rows = await FetchPageAsync(r.Catalog.Id, page, pageSize, !s.UserWaiting, ct);
                        OkloLot[]? snapshot = null;
                        lock (arrived)
                        {
                            arrived[page] = rows;
                            var advanced = false;
                            while (arrived.Remove(next, out var ready)) { lots.AddRange(ready); next++; advanced = true; }
                            if (advanced && progressive && next <= pages) snapshot = lots.ToArray();
                        }
                        if (snapshot is not null) lock (publishLock) Publish(s, snapshot, total, complete: false);
                    }
                    finally { gate.Release(); }
                }));
            }

            if (lots.Count != total)
                log.LogWarning("OKLO sale {Sale}/{Year}: expected {Total} lots, got {Got}", r.SaleNo, r.Year, total, lots.Count);
            Publish(s, lots.ToArray(), total, complete: true);
            s.Error = null;
            if (lots.Count == total && total > 0) await SaveSnapshotAsync(r, lots, total);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Paused for a sale someone is waiting on (MakeRoomFor). Not a failure: no error is recorded, and the next
            // request for this sale starts the pull again.
        }
        catch (Exception ex)
        {
            s.Error = ex.Message;
            log.LogWarning("OKLO live load of sale {Sale}/{Year} failed: {Message}", r.SaleNo, r.Year, ex.Message);
        }
        finally { s.Loading = false; s.UserWaiting = false; s.ForceNext = false; }
    }

    private void Publish(LiveSale s, OkloLot[] lots, int total, bool complete, DateTime? fetchedAt = null)
    {
        var r = s.Ref;
        // A finished sale uses the order the synced workbooks use (broker, then lot number), so a live
        // sale and its file agree. A partial one keeps OKLO's arrival order so it only ever grows at the
        // end — the client appends the new rows instead of re-downloading everything on each poll.
        var ordered = complete ? lots.OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.BrokerLotNumber) : lots.AsEnumerable();
        var parsed = OkloSaleMapper.ToParsed(ordered);
        var (catalogue, built) = builder.BuildSale(r.Year, r.SaleNo, parsed, SaleFileStore.LiveSaleDate(r.Year, r.SaleNo, r.Catalog.AuctionDate));
        catalogue.RowCount = total; // the sale's real size, even while only part of it has arrived
        s.State = new LiveSaleState(catalogue, built.ToArray(), total, complete, complete ? fetchedAt ?? DateTime.UtcNow : s.State.FetchedAtUtc);
    }

    /// <summary>One page of a sale's lots. When OKLO keeps failing on it (its database times out on heavy pages), the
    /// same rows are fetched as two half-size pages — page N of size S is exactly pages 2N-1 and 2N of size S/2.</summary>
    private async Task<List<OkloLot>> FetchPageAsync(int catalogId, int page, int pageSize, bool background, CancellationToken ct)
    {
        try { return (await feed.GetGeneralReportPageAsync(catalogId, page, pageSize, ct, background)).Rows; }
        catch (Exception ex) when (ex is not OperationCanceledException && pageSize >= 200 && pageSize % 2 == 0)
        {
            log.LogWarning("OKLO page {Page} of catalogue {Cat} failed ({Message}) — retrying as two half-size pages", page, catalogId, ex.Message);
            var half = pageSize / 2;
            var a = (await feed.GetGeneralReportPageAsync(catalogId, 2 * page - 1, half, ct, background)).Rows;
            var b = (await feed.GetGeneralReportPageAsync(catalogId, 2 * page, half, ct, background)).Rows;
            return [.. a, .. b];
        }
    }

    /// <summary>
    /// Someone reloaded a page: re-pull the sales they are working with from OKLO NOW, without waiting for the refresh
    /// window. The sales are the ones named plus the two newest active ones (what people work on). Finished sales are
    /// final and never forced; a sale already pulling, or pulled less than ForceRefreshMinSeconds ago, is skipped so a
    /// reload-happy user cannot hammer OKLO. Returns how many pulls were started. Never blocks.
    /// </summary>
    public int RefreshNow(IEnumerable<Guid>? catalogueIds)
    {
        if (!Enabled) return 0;
        var targets = new Dictionary<Guid, LiveSaleRef>();
        foreach (var id in catalogueIds ?? [])
            if (Find(id) is { } named && TierOf(named) != Activity.Archive) targets[named.CatalogueId] = named;
        foreach (var r in Directory.Where(r => TierOf(r) != Activity.Archive).OrderByDescending(r => r.Catalog.AuctionDate).Take(2))
            targets[r.CatalogueId] = r;

        var started = 0;
        var minAge = TimeSpan.FromSeconds(Math.Max(0, _o.ForceRefreshMinSeconds));
        foreach (var r in targets.Values)
        {
            var s = GetOrCreate(r);
            if (s.Loading) continue;
            if (s.State.FetchedAtUtc is { } last && DateTime.UtcNow - last < minAge) continue;
            s.ForceNext = true;
            s.UserWaiting = true; // a person asked: the priority lane, not the background one
            StartLoad(s);
            started++;
        }
        return started;
    }

    // ---- stored snapshots + backfill ---------------------------------------------------------

    private void EnsureSnapshotIndexLoaded()
    {
        lock (_snapIndexGate)
        {
            if (_snapIndexLoaded) return;
            try
            {
                // Reuse an already-in-flight listing rather than firing a second one — a prior
                // call that timed out below leaves one running, and every caller until it lands
                // used to start its own (and, worse, mark the index "loaded" — empty — regardless
                // of whether anything was actually read; see the else branch).
                var listing = _snapIndexLoadTask ??= _snap.ListAsync(default);
                if (listing.Wait(TimeSpan.FromSeconds(20)))
                {
                    foreach (var (id, at) in listing.Result) _snapshotAges[id] = at;
                    _snapIndexLoaded = true;
                    _snapIndexLoadTask = null;
                }
                else
                {
                    // Still running past the wait: do NOT mark the index loaded — that used to
                    // permanently empty it for the rest of the process (every later HasSnapshot
                    // false, BackfillNextAsync re-downloading everything already stored). Apply
                    // the result once it actually lands instead; by then this method's own lock
                    // has long been released, so no deadlock.
                    log.LogWarning("OKLO snapshot index listing exceeded 20s — will apply its result once it completes, and retry meanwhile");
                    listing.ContinueWith(t =>
                    {
                        lock (_snapIndexGate)
                        {
                            if (t.IsCompletedSuccessfully)
                            {
                                foreach (var (id, at) in t.Result) _snapshotAges[id] = at;
                                _snapIndexLoaded = true;
                            }
                            else
                            {
                                log.LogWarning("OKLO snapshot index not loaded: {Message}", t.Exception?.GetBaseException().Message);
                            }
                            _snapIndexLoadTask = null;
                        }
                    }, TaskScheduler.Default);
                }
            }
            catch (Exception ex)
            {
                log.LogWarning("OKLO snapshot index not loaded: {Message}", ex.Message);
                _snapIndexLoadTask = null;
                // A genuine failure (not just slow) still shouldn't be retried in a tight loop —
                // same as the original behavior — so it's marked loaded (empty) here, unlike the
                // timeout case above.
                _snapIndexLoaded = true;
            }
        }
    }

    /// <summary>True when a finished pull of this sale is stored (so it can be read quickly, without OKLO).</summary>
    public bool HasSnapshot(Guid catalogueId)
    {
        EnsureSnapshotIndexLoaded();
        return _snapshotAges.ContainsKey(catalogueId);
    }

    /// <summary>How many sales have a stored snapshot, and the age of the oldest one — for monitoring.</summary>
    public (int Count, DateTime? Oldest) SnapshotSummary()
    {
        EnsureSnapshotIndexLoaded();
        return (_snapshotAges.Count, _snapshotAges.Count == 0 ? null : _snapshotAges.Values.Min());
    }

    private async Task<bool> TryLoadSnapshotAsync(LiveSale s)
    {
        try
        {
            var stored = await _snap.LoadAsync(s.Ref.CatalogueId, default);
            if (stored is null || stored.Lots.Count == 0) return false;
            _counts[s.Ref.Catalog.Id] = stored.Total;
            Publish(s, stored.Lots.ToArray(), stored.Total, complete: true, fetchedAt: stored.FetchedAtUtc);
            return true;
        }
        catch (Exception ex)
        {
            log.LogWarning("OKLO snapshot of sale {Sale}/{Year} unreadable: {Message}", s.Ref.SaleNo, s.Ref.Year, ex.Message);
            return false;
        }
    }

    private async Task SaveSnapshotAsync(LiveSaleRef r, IReadOnlyList<OkloLot> lots, int total)
    {
        try
        {
            var now = DateTime.UtcNow;
            await _snap.SaveAsync(new SaleSnapshot(r.CatalogueId, r.Year, r.SaleNo, now, total, lots.ToList()), default);
            _snapshotAges[r.CatalogueId] = now;
            _counts[r.Catalog.Id] = total;
        }
        catch (Exception ex) { log.LogWarning("OKLO snapshot of sale {Sale}/{Year} not stored: {Message}", r.SaleNo, r.Year, ex.Message); }
    }

    /// <summary>One backfill step: pull the newest sale that has no stored snapshot (or whose snapshot is stale and
    /// still changing), one page at a time on the background lane, and store it. Yields to any sale a person is
    /// waiting on. Returns true when it did (or tried) a pull, so the caller paces the next one.</summary>
    public async Task<bool> BackfillNextAsync(CancellationToken ct)
    {
        // Only the background lane itself matters here, not "is anything at all loading" - a person's own sale, or a
        // routine hot-sale refresh, already yields Gate time to backfill fairly (Gate serializes actual OKLO requests
        // process-wide regardless); backing off completely just because something unrelated is mid-refresh meant backfill
        // sat idle for most of the time the app was open, since a hot sale refreshes every couple of minutes.
        if (!Enabled || _backgroundLoads.CurrentCount == 0) return false;
        EnsureSnapshotIndexLoaded();
        var now = DateTime.UtcNow;
        var candidates = Directory
            .Where(r => !(_backfillFailures.TryGetValue(r.CatalogueId, out var failed) && now - failed < TimeSpan.FromMinutes(30)))
            .Select(r => (Sale: r, Has: _snapshotAges.TryGetValue(r.CatalogueId, out var at), At: at))
            // Missing snapshots first; a stored one only when the sale is still active and the pull is 6h+ old
            // (finished sales are final, so their snapshot is never re-pulled).
            .Where(x => !x.Has || (TierOf(x.Sale) != Activity.Archive && now - x.At > TimeSpan.FromHours(6)))
            .ToList();
        // The neediest YEAR goes first (fewest of its sales snapshotted so far, as a fraction of that year's total on
        // file) - not simply the newest sale overall. Newest-sale-first across the whole directory meant a year with
        // any gap at all (e.g. the current year, constantly growing new sales) permanently starved every older year:
        // it always had a newer candidate, so nothing else ever got a turn. Within the chosen year, newest first still
        // applies - a person is more likely to open a recent sale of whichever year they're looking at.
        var stillNeeded = candidates.Select(x => x.Sale.CatalogueId).ToHashSet();
        var neededFraction = Directory.GroupBy(r => r.Year)
            .ToDictionary(g => g.Key, g => (double)g.Count(r => stillNeeded.Contains(r.CatalogueId)) / g.Count());
        var next = candidates
            .OrderBy(x => x.Has ? 1 : 0)
            .ThenByDescending(x => neededFraction.GetValueOrDefault(x.Sale.Year))
            .ThenByDescending(x => x.Sale.Catalog.AuctionDate)
            .Select(x => x.Sale)
            .FirstOrDefault();
        if (next is null) return false;
        if (Loaded(next.CatalogueId) is { Loading: true }) return false;

        try
        {
            var pageSize = Math.Max(100, _o.LivePageSize);
            var first = await feed.GetGeneralReportPageAsync(next.Catalog.Id, 1, pageSize, ct, background: true);
            var lots = new List<OkloLot>(first.Rows);
            for (var page = 2; page <= (int)Math.Ceiling(first.TotalItems / (double)pageSize); page++)
                lots.AddRange(await FetchPageAsync(next.Catalog.Id, page, pageSize, true, ct));
            if (first.TotalItems == 0 || lots.Count != first.TotalItems)
                throw new InvalidOperationException($"OKLO returned {lots.Count} of {first.TotalItems} lots");
            await SaveSnapshotAsync(next, lots, first.TotalItems);
            log.LogInformation("OKLO snapshot stored: sale {No}/{Year}, {Lots} lots", next.SaleNo, next.Year, lots.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _backfillFailures[next.CatalogueId] = now;
            log.LogWarning("OKLO backfill of sale {No}/{Year} failed: {Message}", next.SaleNo, next.Year, ex.Message);
        }
        return true;
    }

    // ---- reading ---------------------------------------------------------------------------

    /// <summary>The sale's lots as loaded so far. Starts the load if needed and waits (bounded) until
    /// the first rows exist — or, with <paramref name="needComplete"/>, until the whole sale has.
    /// Null when OKLO can't supply it (not a live sale, or the load failed with nothing loaded).</summary>
    /// <param name="userInitiated">False for background work (the valuation re-link): its load uses the background lane and
    /// slot instead of jumping ahead of the sales people are actually opening.</param>
    public async Task<LiveSnapshot?> GetSnapshotAsync(Guid catalogueId, bool needComplete, TimeSpan timeout, CancellationToken ct, bool userInitiated = true)
    {
        if (!await IsLiveAsync(catalogueId)) return null;
        var s = GetOrCreate(Find(catalogueId)!);
        if (userInitiated) s.UserWaiting = true; // a person is waiting: promote this sale's requests to the priority lane
        EnsureFresh(s);
        var deadline = DateTime.UtcNow + timeout;
        var spins = 0;
        while (true)
        {
            if (userInitiated && spins++ % 20 == 0) MakeRoomFor(s);
            var st = s.State;
            if (needComplete ? st.Complete : st.Catalogue is not null) break;
            if (!s.Loading && s.Error is not null && st.Catalogue is null) return null;
            if (!s.Loading && s.LoadTask is null) EnsureFresh(s);
            if (DateTime.UtcNow >= deadline) break;
            await Task.Delay(150, ct);
        }
        return s.Snapshot();
    }

    /// <summary>A lot by id from sales already in memory (never starts a load) — the year and sale
    /// number stamped into the id say which sale to look in.</summary>
    public (Lot Lot, Catalogue Catalogue)? FindLoadedLot(Guid lotId)
    {
        var saleNo = SaleFileStore.SaleNoOfLotId(lotId);
        foreach (var s in AllLoaded())
        {
            if (s.Ref.SaleNo != saleNo) continue;
            var st = s.State;
            if (st.Catalogue is null) continue;
            var hit = st.ById().GetValueOrDefault(lotId);
            if (hit is not null) return (hit, st.Catalogue);
        }
        return null;
    }
}
