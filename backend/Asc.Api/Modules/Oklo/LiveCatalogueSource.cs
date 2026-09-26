using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Http;

namespace Asc.Api.Modules.Oklo;

/// <summary>What the catalogue pages need beyond ICatalogueSource: a snapshot that may still be arriving.</summary>
public interface ILiveCatalogueSource
{
    /// <summary>True when the catalogue is an OKLO sale served live (so a snapshot can be taken).</summary>
    Task<bool> IsLiveAsync(Guid catalogueId);

    /// <summary>The sale as loaded so far — starts the load if needed and waits for the first rows.
    /// Falls back to the last synced file when OKLO cannot supply it. Null when neither can.</summary>
    Task<LiveSnapshot?> GetSnapshotAsync(Guid catalogueId, CancellationToken ct);
}

/// <summary>
/// The catalogue source the app talks to: OKLO first, files as a cache and fallback.
/// - The catalogue pages (list, sale detail, lots) read the live snapshot: every OKLO sale is listed
///   without needing a file, and opening one loads it from OKLO into memory.
/// - Every other read of a sale (Top Price, Dashboard, exports, assistant lot questions...) is live-first
///   too: a sale already in memory is served from there; an active sale (open/published/recent) is loaded
///   live rather than trusting a file that is no longer refreshed; an old sale a file already covers stays
///   on the file (its results are final); an old sale with NO file is loaded live, but only a couple per
///   ten minutes so a report sweeping years of sales cannot turn into hours of OKLO downloads (the rest
///   fall back to files, i.e. are skipped as before). If OKLO cannot supply a sale, its file is the fallback.
/// - Cross-sale sweeps otherwise still lean on files (mark-code index, shared-mark dates): they need the
///   database phase to be fully live.
/// </summary>
public class LiveCatalogueSource(SaleFileStore files, OkloLiveSales live, IHttpContextAccessor? http = null) : ICatalogueSource, ILiveCatalogueSource
{
    /// <summary>True when a web request is behind this read (a person is waiting); false for background jobs, whose OKLO
    /// pulls use the background lane so they can never crowd out the sale someone is opening.</summary>
    private bool PersonWaiting => http is null || http.HttpContext is not null;

    private static readonly TimeSpan FirstRowsTimeout = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan WholeSaleTimeout = TimeSpan.FromMinutes(4);

    /// <summary>Old sales with no file that a single request may pull live per window (see the class doc).</summary>
    private const int ArchiveLoadsPerWindow = 2;
    private static readonly TimeSpan ArchiveWindow = TimeSpan.FromMinutes(10);
    private readonly Queue<DateTime> _archiveLoads = new();

    /// <summary>Synchronous callers (report endpoints) block a request thread while a sale loads. Only a few may do
    /// so at once, and none waits long for a turn - so a burst of report requests can never exhaust the thread pool.
    /// A caller that gets no turn falls back to the file (or skips the sale), exactly as if OKLO were unavailable.</summary>
    private static readonly SemaphoreSlim BlockingLoads = new(3);

    private bool TryAcquireArchiveLoad()
    {
        lock (_archiveLoads)
        {
            var now = DateTime.UtcNow;
            while (_archiveLoads.Count > 0 && now - _archiveLoads.Peek() > ArchiveWindow) _archiveLoads.Dequeue();
            if (_archiveLoads.Count >= ArchiveLoadsPerWindow) return false;
            _archiveLoads.Enqueue(now);
            return true;
        }
    }

    // ---- ILiveCatalogueSource -----------------------------------------------------------------

    public Task<bool> IsLiveAsync(Guid catalogueId) => live.IsLiveAsync(catalogueId);

    public async Task<LiveSnapshot?> GetSnapshotAsync(Guid catalogueId, CancellationToken ct)
    {
        var snap = await live.GetSnapshotAsync(catalogueId, needComplete: false, FirstRowsTimeout, ct);
        if (snap is not null) return snap;
        var catalogue = files.GetCatalogue(catalogueId);
        var lots = files.GetLots(catalogueId);
        return catalogue is null || lots is null
            ? null
            : new LiveSnapshot(catalogue, lots, lots.Count, true, null, false,
                live.Enabled ? "OKLO could not be reached — showing the last synced data." : null);
    }

    // ---- ICatalogueSource ---------------------------------------------------------------------

    public IReadOnlyList<Catalogue> ListCatalogues()
    {
        var inner = files.ListCatalogues();
        if (!live.Enabled) return inner;
        // Very first call with nothing remembered yet: give OKLO a moment to answer rather than list only files.
        if (live.Directory.Count == 0) live.RefreshDirectoryAsync().Wait(TimeSpan.FromSeconds(10));
        var byId = inner.ToDictionary(c => c.Id);
        var seen = new HashSet<Guid>();
        var result = new List<Catalogue>(inner.Count + 8);
        foreach (var r in live.Directory)
        {
            seen.Add(r.CatalogueId);
            if (live.Loaded(r.CatalogueId)?.State.Catalogue is { } loaded) { result.Add(loaded); continue; }
            byId.TryGetValue(r.CatalogueId, out var file);
            result.Add(new Catalogue
            {
                Id = r.CatalogueId,
                Year = r.Year,
                SourceName = $"Sale {r.SaleNo} - {r.Year}",
                Headers = file?.Headers ?? new(),
                RowCount = live.KnownCount(r) ?? file?.RowCount ?? 0,
                ImportedAt = file?.ImportedAt ?? SaleFileStore.LiveSaleDate(r.Year, r.SaleNo, r.Catalog.AuctionDate),
                SaleDateStart = file?.SaleDateStart,
                SaleDateEnd = file?.SaleDateEnd,
            });
        }
        result.AddRange(inner.Where(c => !seen.Contains(c.Id)));
        return result.OrderByDescending(c => c.ImportedAt).ToList();
    }

    public Catalogue? GetCatalogue(Guid id) => LiveFor(id, needComplete: false)?.Catalogue ?? files.GetCatalogue(id);

    public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => LiveFor(catalogueId, needComplete: true)?.Lots ?? files.GetLots(catalogueId);

    public IReadOnlyList<Lot>? GetReportLots(Guid catalogueId) =>
        LiveFor(catalogueId, needComplete: true)?.Lots ?? files.GetReportLots(catalogueId);

    // A lot in a sale held in memory is the freshest copy (its file, if any, is no longer refreshed).
    public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => live.FindLoadedLot(lotId) ?? files.FindLot(lotId);

    public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId)
    {
        var fromFile = files.GetValuedSlim(catalogueId);
        if (fromFile.Count > 0) return fromFile;
        var loaded = live.Loaded(catalogueId)?.State;
        return loaded?.Catalogue is null
            ? fromFile
            : loaded.Lots.Where(l => l.Valuation is not null).Select(l => new ValuedLotSlim(l.Id, l.RowKey, l.Grade, l.Valuation!)).ToList();
    }

    public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => files.SalesInMonth(year, month);
    // Built from what is ALREADY available (memory, stored snapshots, files) — never by pulling sales from OKLO. An index
    // sweeps every sale it has not seen; if that meant a live pull each, it would keep every OKLO slot busy for hours and
    // starve the pages people are using. Sales not available yet are simply picked up on a later call, as the backfill
    // stores their snapshots.
    public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() => files.GetMarkCodeIndex(new AvailableOnly(this));
    public IReadOnlyDictionary<string, DateTime> GetRecentlySharedFactoryCodeDates() => files.GetRecentlySharedFactoryCodeDates(new AvailableOnly(this));

    /// <summary>The complete lots of a sale only if they can be had without asking OKLO: held in memory, stored as a
    /// snapshot, or in a file. Null otherwise.</summary>
    private IReadOnlyList<Lot>? AvailableLots(Guid id)
    {
        if (live.Enabled && live.Find(id) is not null && (live.Loaded(id)?.State.Complete == true || live.HasSnapshot(id)))
        {
            var snap = live.GetSnapshotAsync(id, needComplete: true, TimeSpan.FromSeconds(30), default, userInitiated: false).GetAwaiter().GetResult();
            if (snap is { Complete: true }) return snap.Lots;
        }
        return files.GetReportLots(id);
    }

    private Catalogue? FileCatalogue(Guid id) => files.GetCatalogue(id);

    /// <summary>The view of this source that index builders use: same sale list, lots only from what is already available.</summary>
    private sealed class AvailableOnly(LiveCatalogueSource owner) : ICatalogueSource
    {
        public IReadOnlyList<Catalogue> ListCatalogues() => owner.ListCatalogues();
        public IReadOnlyList<Lot>? GetReportLots(Guid catalogueId) => owner.AvailableLots(catalogueId);
        public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => owner.AvailableLots(catalogueId);
        public Catalogue? GetCatalogue(Guid id) => owner.FileCatalogue(id);
        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => owner.FindLot(lotId);
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => owner.GetValuedSlim(catalogueId);
        public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => owner.SalesInMonth(year, month);
        public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() => owner.GetMarkCodeIndex();
        public IReadOnlyDictionary<string, DateTime> GetRecentlySharedFactoryCodeDates() => owner.GetRecentlySharedFactoryCodeDates();
    }

    /// <summary>The live copy of a sale for a synchronous caller (blocks while it loads), or null when the
    /// caller should use the file: not an OKLO sale, an old sale a file already covers, an old file-less sale
    /// past the load budget, or OKLO could not supply it.</summary>
    private LiveSnapshot? LiveFor(Guid id, bool needComplete)
    {
        if (!live.Enabled) return null;
        if (live.Directory.Count == 0) live.RefreshDirectoryAsync().Wait(TimeSpan.FromSeconds(10));
        if (live.Find(id) is not { } sale) return null;

        var held = live.Loaded(id)?.State;
        var inMemory = held is not null && (needComplete ? held.Complete : held.Catalogue is not null);
        // A finished sale with a stored snapshot reads from it (fast, no OKLO call); one a file covers stays
        // on the file; a sale with neither may be pulled live, but only a couple per window.
        if (!inMemory && !live.IsActive(sale) && !live.HasSnapshot(id) && (files.HasFile(id) || !TryAcquireArchiveLoad())) return null;

        LiveSnapshot? snap;
        if (inMemory)
        {
            // A sale already in memory answers at once and needs no turn.
            snap = live.GetSnapshotAsync(id, needComplete, TimeSpan.FromSeconds(5), default, PersonWaiting).GetAwaiter().GetResult();
        }
        else
        {
            if (!BlockingLoads.Wait(TimeSpan.FromSeconds(5))) return null;
            try { snap = live.GetSnapshotAsync(id, needComplete, needComplete ? WholeSaleTimeout : FirstRowsTimeout, default, PersonWaiting).GetAwaiter().GetResult(); }
            finally { BlockingLoads.Release(); }
        }
        // A caller that needs the whole sale (reports, the mark-code index) must never be handed the part that has arrived
        // so far as if it were everything: if the wait ran out, treat the sale as unavailable, exactly as if OKLO were down.
        return needComplete && snap is { Complete: false } ? null : snap;
    }
}
