using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace Asc.Api.Modules.Oklo;

/// <summary>Bookkeeping for one OKLO sale, persisted in data/oklo/state.json.</summary>
public class OkloSaleState
{
    public int CatalogId { get; set; }
    public int Year { get; set; }
    public int SaleNo { get; set; }
    public string Name { get; set; } = "";
    public string StatusName { get; set; } = "";
    public DateTime? AuctionDate { get; set; }
    public int Lots { get; set; }
    /// <summary>SHA-256 of the mapped rows; identical content skips the rewrite (and the 25s re-parse).</summary>
    public string Hash { get; set; } = "";
    public DateTime? LastCheckedUtc { get; set; }
    public DateTime? LastChangedUtc { get; set; }
    /// <summary>Consecutive pulls that found identical content — drives the back-off of recent sales.</summary>
    public int UnchangedStreak { get; set; }
    public string? LastError { get; set; }
}

public record OkloSyncResult(int CatalogId, int Year, int SaleNo, int Lots, bool Changed, bool Skipped, string? Note);

/// <summary>
/// Pulls sales from OKLO into data/sales (as API-built "General Report" workbooks, see
/// OkloSaleMapper) so the file-backed catalogue store, its caches and every report keep working
/// unchanged. Decides what is due by age: a sale within a day of its auction is "live", a recent
/// or still-open one is "recent", everything else is "archive" (and un-imported ones are
/// back-filled newest-first, lowest priority). One sale syncs at a time.
/// </summary>
public class OkloSyncService(OkloClient client, SaleFileStore files, MongoContext db, OkloLiveSales live, IOptions<OkloOptions> options, ILogger<OkloSyncService> log)
{
    private static readonly JsonSerializerOptions StateJson = new() { WriteIndented = true };
    private static readonly TimeSpan SriLankaOffset = TimeSpan.FromMinutes(330);

    private readonly OkloOptions _o = options.Value;
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private readonly object _stateLock = new();
    private Dictionary<int, OkloSaleState>? _state;
    private List<OkloCatalog> _catalogs = [];
    private DateTime _catalogsAtUtc = DateTime.MinValue;
    private DateTime _lastLoopUtc = DateTime.MinValue;
    private string? _running;
    private string? _lastError;
    private int _steps;

    public bool IsConfigured => client.IsConfigured;
    public bool AutoSync => _o.AutoSync;

    /// <summary>When any sale was last checked against OKLO — the UI's "data updated" stamp.</summary>
    public DateTime? NewestCheckedUtc => State().Values.Max(s => s.LastCheckedUtc);

    private string DataDir => Path.GetFullPath(Path.Combine(files.SalesDir, ".."));
    private string StatePath => Path.Combine(DataDir, "oklo", "state.json");

    // ---- catalogue → (year, sale no) ---------------------------------------------------

    /// <summary>The (year, sale number) a catalogue maps to, or null for OKLO's mock/test
    /// catalogues ("Sale 35-SEP13", "Sale 28 T2") and anything before FirstYear. Year is the
    /// auction date's year — sale numbers restart each January.</summary>
    internal (int Year, int SaleNo)? Identify(OkloCatalog c) => OkloSaleMapper.Identify(c, _o.FirstYear);

    private string TargetPath(int year, int saleNo) => Path.Combine(files.SalesDir, year.ToString(), $"{saleNo:00}.xlsx");

    // ---- state -------------------------------------------------------------------------

    private Dictionary<int, OkloSaleState> State()
    {
        lock (_stateLock)
        {
            if (_state is not null) return _state;
            try
            {
                if (File.Exists(StatePath))
                    _state = JsonSerializer.Deserialize<List<OkloSaleState>>(File.ReadAllText(StatePath))?.ToDictionary(s => s.CatalogId);
            }
            catch (Exception ex) { log.LogWarning(ex, "OKLO state file unreadable — starting empty"); }
            return _state ??= new();
        }
    }

    private void SaveState()
    {
        lock (_stateLock)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
                var tmp = StatePath + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(State().Values.OrderBy(s => s.CatalogId).ToList(), StateJson));
                File.Move(tmp, StatePath, overwrite: true);
            }
            catch (Exception ex) { log.LogWarning(ex, "OKLO state file not saved"); }
        }
    }

    // ---- syncing -----------------------------------------------------------------------

    public async Task<IReadOnlyList<OkloCatalog>> RefreshCatalogListAsync(CancellationToken ct)
    {
        _catalogs = await client.ListCatalogsAsync(ct);
        _catalogsAtUtc = DateTime.UtcNow;
        return _catalogs;
    }

    /// <summary>Pulls one sale and (re)writes its workbook if the content changed.</summary>
    public async Task<OkloSyncResult> SyncCatalogAsync(OkloCatalog catalog, CancellationToken ct)
    {
        var id = Identify(catalog) ?? throw new InvalidOperationException($"Catalogue {catalog.Id} ({catalog.SaleNumber}) is not a numbered sale.");
        await _syncLock.WaitAsync(ct);
        try
        {
            _running = $"Sale {id.SaleNo}/{id.Year}";
            var state = State().TryGetValue(catalog.Id, out var s) ? s : State()[catalog.Id] = new OkloSaleState { CatalogId = catalog.Id };
            state.Year = id.Year; state.SaleNo = id.SaleNo; state.Name = catalog.Name ?? "";
            state.StatusName = catalog.StatusName ?? ""; state.AuctionDate = catalog.AuctionDate;
            try
            {
                var lots = await client.GetSaleLotsAsync(catalog.Id, ct);
                state.LastCheckedUtc = DateTime.UtcNow;
                var target = TargetPath(id.Year, id.SaleNo);

                // An empty answer for a sale we already hold is far more likely an API hiccup
                // than a wiped sale — never replace a good file with nothing.
                if (lots.Count == 0)
                {
                    state.LastError = null;
                    SaveState();
                    return new OkloSyncResult(catalog.Id, id.Year, id.SaleNo, 0, false, true, "OKLO returned no lots yet (catalogue not populated).");
                }

                var rows = lots.OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.BrokerLotNumber).Select(OkloSaleMapper.MapRow).ToList();
                var hash = HashRows(rows);
                var catalogueId = SaleFileStore.CatalogueIdFor(id.Year, id.SaleNo);
                // A hand-downloaded file is about to be replaced by an API-built one: lots switch from the
                // legacy content-hash id to OKLO's stable key, so remember the old ids first and re-link
                // everything that references them (valuations, media) once the new file is in place.
                if (File.Exists(target) && string.IsNullOrEmpty(state.Hash) && !File.Exists(LegacyIdsPath(catalogueId)))
                    SnapshotLegacyIds(catalogueId);
                var changed = hash != state.Hash || !File.Exists(target);
                if (changed)
                {
                    OkloSaleWriter.Write(target, rows);
                    await MigrateLegacyIdsAsync(catalogueId, ct);
                    WarmParse(catalogueId);
                    state.Hash = hash;
                    state.Lots = rows.Count;
                    state.LastChangedUtc = DateTime.UtcNow;
                    log.LogInformation("OKLO sale {No}/{Year}: {Lots} lots written", id.SaleNo, id.Year, rows.Count);
                }
                state.UnchangedStreak = changed ? 0 : state.UnchangedStreak + 1;
                if (!changed && File.Exists(LegacyIdsPath(catalogueId)))
                    await MigrateLegacyIdsAsync(catalogueId, ct); // a previous run was interrupted mid-migration
                state.LastError = null;
                SaveState();
                return new OkloSyncResult(catalog.Id, id.Year, id.SaleNo, rows.Count, changed, false, null);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                state.LastError = ex.Message;
                _lastError = ex.Message;
                SaveState();
                log.LogWarning(ex, "OKLO sync of catalogue {Id} failed", catalog.Id);
                throw;
            }
        }
        finally
        {
            _running = null;
            _syncLock.Release();
        }
    }

    // ---- legacy lot-id migration --------------------------------------------------------

    private string LegacyIdsPath(Guid catalogueId) => Path.Combine(DataDir, "oklo", $"legacy-ids-{catalogueId}.json");
    private string MediaDir => Path.Combine(DataDir, "media");
    private static string LotKey(Lot l) => $"{l.Broker?.Trim()}|{l.LotNumber?.Trim()}";

    /// <summary>Persists broker|lot -> old lot id for the file that is about to be replaced. Written
    /// before the file is touched and removed only when the re-link finishes, so an interruption
    /// between the two can always be resumed.</summary>
    private void SnapshotLegacyIds(Guid catalogueId)
    {
        var map = new Dictionary<string, Guid>();
        foreach (var l in files.GetLots(catalogueId) ?? [])
            map.TryAdd(LotKey(l), l.Id);
        Directory.CreateDirectory(Path.GetDirectoryName(LegacyIdsPath(catalogueId))!);
        File.WriteAllText(LegacyIdsPath(catalogueId), JsonSerializer.Serialize(map));
    }

    /// <summary>Re-links stored valuations (Mongo) and lot media (data/media/{lotId}) from the old
    /// lot ids to the ids the API-built file produces, matching lots on broker + lot number.
    /// Idempotent: safe to re-run after a crash.</summary>
    private async Task MigrateLegacyIdsAsync(Guid catalogueId, CancellationToken ct, IReadOnlyList<Lot>? newLots = null)
    {
        var path = LegacyIdsPath(catalogueId);
        if (!File.Exists(path)) return;
        var oldByKey = JsonSerializer.Deserialize<Dictionary<string, Guid>>(File.ReadAllText(path)) ?? new();
        var newByKey = new Dictionary<string, Lot>();
        foreach (var l in newLots ?? files.GetLots(catalogueId) ?? []) newByKey.TryAdd(LotKey(l), l);
        var keyByOldId = oldByKey.ToDictionary(kv => kv.Value, kv => kv.Key);

        var relinked = 0; var orphaned = 0;
        var stored = await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct);
        var ops = new List<WriteModel<StoredValuation>>();
        foreach (var v in stored)
        {
            if (!keyByOldId.TryGetValue(v.LotId, out var key)) continue; // already on a new id
            if (!newByKey.TryGetValue(key, out var lot)) { orphaned++; continue; }
            if (lot.Id == v.LotId) continue;
            ops.Add(new ReplaceOneModel<StoredValuation>(Builders<StoredValuation>.Filter.Eq(x => x.LotId, lot.Id),
                new StoredValuation { LotId = lot.Id, CatalogueId = catalogueId, RowKey = lot.RowKey, Valuation = v.Valuation }) { IsUpsert = true });
            ops.Add(new DeleteOneModel<StoredValuation>(Builders<StoredValuation>.Filter.Eq(x => x.LotId, v.LotId)));
            relinked++;
        }
        if (ops.Count > 0) await db.Valuations.BulkWriteAsync(ops, new BulkWriteOptions { IsOrdered = true }, ct);

        var mediaMoved = 0;
        foreach (var (key, oldId) in oldByKey)
        {
            if (!newByKey.TryGetValue(key, out var lot) || lot.Id == oldId) continue;
            var from = Path.Combine(MediaDir, oldId.ToString());
            var to = Path.Combine(MediaDir, lot.Id.ToString());
            if (Directory.Exists(from) && !Directory.Exists(to)) { Directory.Move(from, to); mediaMoved++; }
        }
        File.Delete(path);
        if (relinked + orphaned + mediaMoved > 0)
            log.LogInformation("OKLO id migration for catalogue {Cat}: {Relinked} valuations re-linked, {Orphaned} orphaned, {Media} media folders moved", catalogueId, relinked, orphaned, mediaMoved);
    }

    /// <summary>Finishes every re-link still waiting in data/oklo/legacy-ids-*.json — for sales whose old
    /// file is gone and whose lots now come live from OKLO (stable ids). Each sale is loaded live (priority
    /// lane), its stored valuations and lot media are moved from the old ids to the new, and the marker file
    /// is removed. Safe to call repeatedly; returns how many sales were migrated.</summary>
    public async Task<int> MigratePendingAsync(CancellationToken ct)
    {
        var dir = Path.GetDirectoryName(LegacyIdsPath(Guid.Empty))!;
        if (!Directory.Exists(dir)) return 0;
        var migrated = 0;
        foreach (var file in Directory.GetFiles(dir, "legacy-ids-*.json"))
        {
            var name = Path.GetFileNameWithoutExtension(file)["legacy-ids-".Length..];
            if (!Guid.TryParse(name, out var catalogueId)) continue;
            // A stored snapshot answers at once; otherwise the sale is loaded live (can take minutes).
            var snap = await live.GetSnapshotAsync(catalogueId, needComplete: true, TimeSpan.FromMinutes(live.HasSnapshot(catalogueId) ? 2 : 8), ct, userInitiated: false);
            if (snap is not { Complete: true })
            {
                log.LogWarning("OKLO re-link: sale {Cat} could not be loaded yet — will retry", catalogueId);
                continue;
            }
            await MigrateLegacyIdsAsync(catalogueId, ct, snap.Lots);
            migrated++;
        }
        return migrated;
    }

    /// <summary>Reads the new file once now so the catalogue list shows its lot count straight away
    /// (and the first user to open it doesn't wait for the parse). Best-effort: never fails a sync.</summary>
    private void WarmParse(Guid catalogueId)
    {
        try { files.GetCatalogue(catalogueId); }
        catch (Exception ex) { log.LogWarning("OKLO: warm parse of {Cat} failed: {Message}", catalogueId, ex.Message); }
    }

    private static string HashRows(List<string[]> rows)
    {
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var r in rows)
            sha.AppendData(Encoding.UTF8.GetBytes(string.Join("|", r) + Environment.NewLine));
        return Convert.ToHexString(sha.GetHashAndReset());
    }

    // ---- scheduling --------------------------------------------------------------------

    private enum Tier { Live = 0, Recent = 1, Archive = 2, Backfill = 3 }

    private static DateTime ColomboToday(DateTime utcNow) => (utcNow + SriLankaOffset).Date;

    private (Tier Tier, TimeSpan Interval) Classify(OkloCatalog c, OkloSaleState? st, DateTime utcNow)
    {
        if (st is null || st.LastCheckedUtc is null) return (Tier.Backfill, TimeSpan.Zero);
        // A sale whose last pull failed comes back sooner than its tier would say — OKLO's 500s are transient.
        if (st.LastError is not null) return (Tier.Archive, TimeSpan.FromMinutes(30));
        var today = ColomboToday(utcNow);
        var date = c.AuctionDate?.Date ?? DateTime.MinValue;
        var openish = c.StatusId is 3 or 4;
        if (Math.Abs((date - today).TotalDays) <= 1) return (Tier.Live, TimeSpan.FromMinutes(_o.LiveRefreshMinutes));
        // Recent sales back off while nothing changes (5 -> 10 -> 20 -> 40 -> 60 min): each pull costs
        // ~75-170s of OKLO time, so re-pulling six unchanged sales every 5 minutes would leave no
        // room for anything else. A change resets the streak, so an active sale stays snappy.
        if (openish || (today - date).TotalDays <= _o.RecentWindowDays)
            return (Tier.Recent, TimeSpan.FromMinutes(Math.Min(60, _o.RecentRefreshMinutes * Math.Pow(2, Math.Min(st.UnchangedStreak, 4)))));
        return (Tier.Archive, TimeSpan.FromHours(_o.ArchiveRefreshHours));
    }

    /// <summary>The single most urgent sale that is due (live before recent before archive before
    /// never-imported; newest first within a tier), or null. <paramref name="maxAge"/> overrides
    /// the tier intervals for on-demand refreshes ("refresh whatever is older than a minute").</summary>
    internal OkloCatalog? NextDue(DateTime utcNow, TimeSpan? maxAge, bool recentOnly, bool backgroundFirst = false)
    {
        var best = default((OkloCatalog C, Tier T, DateTime Date)?);
        // On-demand refreshes (someone opened the app) only override the back-off for live sales and the
        // three newest live/recent ones — the sales people are actually working in.
        var hot = _catalogs.Where(c => Identify(c) is not null && Classify(c, State().GetValueOrDefault(c.Id), utcNow).Tier <= Tier.Recent)
            .OrderByDescending(c => c.AuctionDate).Take(3).Select(c => c.Id).ToHashSet();
        foreach (var c in _catalogs)
        {
            if (Identify(c) is null) continue;
            State().TryGetValue(c.Id, out var st);
            var (tier, interval) = Classify(c, st, utcNow);
            if (recentOnly && tier > Tier.Recent) continue;
            var age = st?.LastCheckedUtc is { } t ? utcNow - t : TimeSpan.MaxValue;
            var limit = maxAge is { } m && (tier == Tier.Live || hot.Contains(c.Id)) ? (m < interval ? m : interval) : interval;
            if (age < limit) continue;
            var date = c.AuctionDate ?? DateTime.MinValue;
            // backgroundFirst flips the priority (archive/back-fill before live/recent) for one pick, so a
            // recent tier that never goes idle (each pull is ~75s) can't starve the archive back-fill.
            var better = best is null
                || (backgroundFirst ? tier > best.Value.T : tier < best.Value.T)
                || (tier == best.Value.T && date > best.Value.Date);
            if (better) best = (c, tier, date);
        }
        return best?.C;
    }

    /// <summary>One scheduler step: keep the catalogue list fresh, then sync the most urgent due
    /// sale. Returns how long the loop should pause before the next step, or null when nothing was due
    /// (then it naps). Live/recent sales get a short pause; archive/back-fill work is throttled so a
    /// multi-hour import never starves the app of CPU and memory on a modest machine.</summary>
    public async Task<TimeSpan?> StepAsync(TimeSpan? maxAge, bool recentOnly, CancellationToken ct)
    {
        _lastLoopUtc = DateTime.UtcNow;
        // A sale someone is opening has OKLO's attention first; the file sync (an analytics cache) waits.
        if (live.IsBusy) return TimeSpan.FromSeconds(15);
        if (_catalogs.Count == 0 || DateTime.UtcNow - _catalogsAtUtc > TimeSpan.FromMinutes(_o.CatalogListMinutes))
            await RefreshCatalogListAsync(ct);
        // Every third step goes to the archive/back-fill (if any is due) so a busy live/recent tier can't
        // starve it; on-demand refreshes (recentOnly) skip this — the user is waiting on fresh data.
        var backgroundTurn = !recentOnly && _steps++ % 3 == 2;
        var next = (backgroundTurn ? NextDue(DateTime.UtcNow, maxAge, recentOnly, backgroundFirst: true) : null)
            ?? NextDue(DateTime.UtcNow, maxAge, recentOnly);
        if (next is null) return null;
        try { await SyncCatalogAsync(next, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Mark it checked so one failing sale can't monopolise the loop; LastError shows why.
            if (State().TryGetValue(next.Id, out var st)) { st.LastCheckedUtc = DateTime.UtcNow; SaveState(); }
        }
        return Classify(next, State().GetValueOrDefault(next.Id), DateTime.UtcNow).Tier <= Tier.Recent
            ? TimeSpan.FromSeconds(2)
            : TimeSpan.FromSeconds(_o.BackgroundPauseSeconds);
    }

    // ---- status ------------------------------------------------------------------------

    public object GetStatus() => new
    {
        configured = IsConfigured,
        autoSync = AutoSync,
        running = _running,
        lastError = _lastError,
        catalogListAtUtc = _catalogsAtUtc == DateTime.MinValue ? (DateTime?)null : _catalogsAtUtc,
        lastLoopUtc = _lastLoopUtc == DateTime.MinValue ? (DateTime?)null : _lastLoopUtc,
        totalSales = _catalogs.Count(c => Identify(c) is not null),
        importedSales = State().Values.Count(s => s.LastChangedUtc is not null),
        newestCheckedUtc = NewestCheckedUtc,
        sales = State().Values.OrderByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).Take(60).Select(s => new
        {
            s.Year, s.SaleNo, s.StatusName, s.Lots, s.LastCheckedUtc, s.LastChangedUtc, s.LastError,
        }),
    };
}
