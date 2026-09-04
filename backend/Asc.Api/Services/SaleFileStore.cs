using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Asc.Api.Models;

namespace Asc.Api.Services;

/// <summary>
/// The catalogue-source seam. Every read of sale/lot data goes through this interface, so
/// the local file-backed store below can be swapped for a database-backed implementation
/// (e.g. Azure) later without touching any controller — only user-entered valuations live
/// in the database (see <see cref="StoredValuation"/>); catalogue data does not.
/// </summary>
public interface ICatalogueSource
{
    /// <summary>All known sales, newest first. Cheap — full data loads on demand.</summary>
    IReadOnlyList<Catalogue> ListCatalogues();

    /// <summary>Full catalogue (headers + column meta) — loads the sale if needed.</summary>
    Catalogue? GetCatalogue(Guid id);

    /// <summary>Every lot of a sale, or null for an unknown catalogue. Loads on demand.</summary>
    IReadOnlyList<Lot>? GetLots(Guid catalogueId);

    /// <summary>Resolve a lot id back to its lot + catalogue (loads its sale on demand).</summary>
    (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId);

    /// <summary>Just the valued lots of a sale, from the slim cache — cheap enough to call
    /// for every previous sale when building classification history.</summary>
    IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId);

    /// <summary>Every sale number whose resolved date falls in the given calendar month,
    /// ascending — including sale numbers with no file on disk yet (e.g. later weeks of the
    /// month that haven't happened). Reports that lay out one column per week of a month
    /// (Sharing Mark Catalogued Summary) need the full month's calendar up front, not just
    /// whichever sales already have data, so future weeks render as blank columns instead
    /// of being omitted entirely.</summary>
    IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month);

    /// <summary>Every Trade Mark/Factory code seen across every catalogue on file, mapped to
    /// its canonical Selling Mark spelling and non-blank Sub Elevation (first-seen-wins).
    /// Built once and persisted to disk (see SaleFileStore's own doc comment) — every call
    /// after the first only has to parse whichever catalogues have appeared since the index
    /// was last built, not the entire multi-year corpus, so callers doing a cross-year
    /// code lookup (SharedMarkCatalogueService) don't re-pay a full scan on every request.</summary>
    IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex();
}

/// <summary>One valued lot, reduced to what classification history needs.</summary>
public record ValuedLotSlim(Guid LotId, string RowKey, string? Grade, Valuation Valuation);

/// <summary>
/// Reads the company's weekly-sale Excel files straight from data/sales — the files ARE
/// the catalogue store (the database only holds user-entered valuations). Files are named
/// by sale number (01.xlsx … 30.xlsx); dropping next week's file into the folder is all it
/// takes for the sale to appear — the folder is rescanned on every listing. Sales are
/// year-wise: 2026 (<see cref="LegacyYear"/>) is the legacy namespace and may sit flat in
/// data/sales, under data/sales/2026/, or split across both — same hash formula either way;
/// any other year lives under data/sales/{year}/.
///
/// A 35MB market file takes ~25s to parse, so each parse is cached under data/.cache as
/// gzipped JSON keyed by the file's size+mtime: full reloads take ~1–2s and survive
/// restarts, and an edited/replaced file re-parses automatically. Recently used sales stay
/// in memory (small LRU); a slim valued-lots extract per sale is kept separately so
/// classification history never needs 29 full sales in memory.
///
/// All ids are deterministic (MD5 of sale number / row key, plus year for anything other
/// than the legacy 2026 namespace — see the CatalogueIdFor/LotIdFor overloads below), so
/// lot references and stored valuations stay valid across restarts and cache rebuilds. A
/// lot id embeds its sale number in the first two bytes (plus its year in the next two, for
/// non-legacy ids), so an id alone is enough to find the right file — see FindLot.
/// </summary>
public class SaleFileStore(CatalogueImportService importer, IWebHostEnvironment env) : ICatalogueSource
{
    /// <summary>The legacy single-year namespace: predates year-awareness and keeps its
    /// original identity (CatalogueIdFor(saleNo)/LotIdFor(saleNo, rowKey)) forever, regardless
    /// of whether its files sit flat in data/sales or under data/sales/2026/.</summary>
    public const int LegacyYear = 2026;

    /// <summary>One anchor date per year — every other sale in that year is a week apart
    /// from its anchor's sale number. Only needed for a year with no <see cref="YearSaleDates"/>
    /// entries; this is deliberately not config-driven since it changes maybe once a year.</summary>
    private static readonly Dictionary<int, (int SaleNo, DateTime Date)> YearAnchors = new()
    {
        [2026] = (28, new DateTime(2026, 7, 21, 9, 30, 0, DateTimeKind.Utc)),
    };

    /// <summary>Real per-sale dates, read from each file's own "Selling End Time" column
    /// (min value per sale) rather than assumed from a weekly offset — real auction weeks
    /// aren't always exactly 7 days apart (see the 2025 gaps below), so this is more accurate
    /// than YearAnchors wherever it's populated. Takes priority over YearAnchors when both
    /// have an entry for a sale.
    /// 2025: sale 4's source file read "29/01/2024" in that column — an evident year typo,
    /// bracketed by sale 3 (22/01/2025) and sale 5 (05/02/2025) a week either side — corrected
    /// to 2025 here.</summary>
    private static readonly Dictionary<int, Dictionary<int, DateTime>> YearSaleDates = new()
    {
        [2025] = new()
        {
            [1] = new DateTime(2025, 1, 8), [2] = new DateTime(2025, 1, 15), [3] = new DateTime(2025, 1, 22),
            [4] = new DateTime(2025, 1, 29), [5] = new DateTime(2025, 2, 5), [6] = new DateTime(2025, 2, 11),
            [7] = new DateTime(2025, 2, 19), [8] = new DateTime(2025, 2, 26), [9] = new DateTime(2025, 3, 5),
            [10] = new DateTime(2025, 3, 11), [11] = new DateTime(2025, 3, 19), [12] = new DateTime(2025, 3, 26),
            [13] = new DateTime(2025, 4, 2), [14] = new DateTime(2025, 4, 8), [15] = new DateTime(2025, 4, 23),
            [16] = new DateTime(2025, 4, 29), [17] = new DateTime(2025, 5, 7), [18] = new DateTime(2025, 5, 14),
            [19] = new DateTime(2025, 5, 21), [20] = new DateTime(2025, 5, 28), [21] = new DateTime(2025, 6, 4),
            [22] = new DateTime(2025, 6, 11), [23] = new DateTime(2025, 6, 18), [24] = new DateTime(2025, 6, 25),
            [25] = new DateTime(2025, 7, 2), [26] = new DateTime(2025, 7, 8), [27] = new DateTime(2025, 7, 16),
            [28] = new DateTime(2025, 7, 23), [29] = new DateTime(2025, 7, 30), [30] = new DateTime(2025, 8, 5),
            [31] = new DateTime(2025, 8, 13), [32] = new DateTime(2025, 8, 20), [33] = new DateTime(2025, 8, 27),
            [34] = new DateTime(2025, 9, 2), [35] = new DateTime(2025, 9, 10), [36] = new DateTime(2025, 9, 17),
            [37] = new DateTime(2025, 9, 24), [38] = new DateTime(2025, 9, 30), [39] = new DateTime(2025, 10, 8),
            [40] = new DateTime(2025, 10, 15), [41] = new DateTime(2025, 10, 22), [42] = new DateTime(2025, 10, 29),
            [43] = new DateTime(2025, 11, 4), [44] = new DateTime(2025, 11, 12), [45] = new DateTime(2025, 11, 19),
            [46] = new DateTime(2025, 11, 26), [47] = new DateTime(2025, 12, 9), [48] = new DateTime(2025, 12, 16),
            [49] = new DateTime(2025, 12, 23), [50] = new DateTime(2025, 12, 30),
        },
    };

    private const int MaxLoadedSales = 4;

    private readonly object _mapLock = new();
    private readonly Dictionary<(int Year, int SaleNo), object> _saleLocks = new();
    private readonly Dictionary<(int Year, int SaleNo), LoadedSale> _loaded = new();
    private readonly Dictionary<(int Year, int SaleNo), (Signature Sig, ValuedLotSlim[] Rows)> _slims = new();
    private readonly Dictionary<(int Year, int SaleNo), (Signature Sig, SaleMeta Meta)> _meta = new();
    private long _touchCounter;
    private bool _metaFileLoaded;
    private int _warmInFlight; // 0 = idle, 1 = a background catch-up warm pass is running

    private sealed record Signature(long Size, long MTimeTicks);
    private sealed record SaleFile(int Year, int SaleNo, string Path, Signature Sig)
    {
        public bool IsLegacy => Year == LegacyYear;
    }
    private sealed class SaleMeta
    {
        public int RowCount { get; set; }
        public List<string> Headers { get; set; } = new();
    }

    private sealed class LoadedSale
    {
        public required Signature Sig { get; init; }
        public required Catalogue Catalogue { get; init; }
        public required List<Lot> Lots { get; init; }
        public required Dictionary<Guid, Lot> ById { get; init; }
        public long Touch { get; set; }
    }

    /// <summary>On-disk shape of a fully parsed sale (data/.cache/sale-N.json.gz).</summary>
    private sealed class CachedSale
    {
        public long Size { get; set; }
        public long MTimeTicks { get; set; }
        public Catalogue Catalogue { get; set; } = null!;
        public List<Lot> Lots { get; set; } = null!;
    }

    public string SalesDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "sales"));
    private string CacheDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", ".cache"));

    // ---- deterministic identity ------------------------------------------------------

    // Legacy (2026, flat-root) ids are frozen exactly as they were before years existed —
    // already-stored valuations/reports/webhooks reference them, so this hash and its inputs
    // must never change. Every year other than 2026 folds year into the hash from the start,
    // since there's no existing data to protect there.

    public static Guid CatalogueIdFor(int saleNo) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes($"sale:{saleNo}")));

    public static Guid CatalogueIdFor(int year, int saleNo) =>
        year == LegacyYear ? CatalogueIdFor(saleNo) : new(MD5.HashData(Encoding.UTF8.GetBytes($"sale:{year}:{saleNo}")));

    /// <summary>Lot id = MD5 of sale + row key, with the sale number stamped into the
    /// first two bytes so the id alone identifies which file to load.</summary>
    public static Guid LotIdFor(int saleNo, string rowKey)
    {
        var hash = MD5.HashData(Encoding.UTF8.GetBytes($"lot:{saleNo}:{rowKey}"));
        hash[0] = (byte)(saleNo & 0xFF);
        hash[1] = (byte)((saleNo >> 8) & 0xFF);
        return new Guid(hash);
    }

    /// <summary>Non-legacy lot id: same sale-number stamping as the legacy scheme (bytes
    /// 0-1), plus the year stamped into bytes 2-3 so FindLot can locate the right year's
    /// file straight from the id, the same way it already does for sale number.</summary>
    public static Guid LotIdFor(int year, int saleNo, string rowKey)
    {
        if (year == LegacyYear) return LotIdFor(saleNo, rowKey);
        var hash = MD5.HashData(Encoding.UTF8.GetBytes($"lot:{year}:{saleNo}:{rowKey}"));
        hash[0] = (byte)(saleNo & 0xFF);
        hash[1] = (byte)((saleNo >> 8) & 0xFF);
        hash[2] = (byte)(year & 0xFF);
        hash[3] = (byte)((year >> 8) & 0xFF);
        return new Guid(hash);
    }

    private static int SaleNoOfLotId(Guid lotId)
    {
        var b = lotId.ToByteArray();
        return b[0] | (b[1] << 8);
    }

    private static int YearHintOfLotId(Guid lotId)
    {
        var b = lotId.ToByteArray();
        return b[2] | (b[3] << 8);
    }

    /// <summary>Real date if known (YearSaleDates), else the weekly-offset anchor if the
    /// year has one (YearAnchors), else the file's last-write time — e.g. new files dropped
    /// in before either is known. Sales still list with a usable date instead of the whole
    /// listing failing.</summary>
    private static DateTime SaleDateFor(int year, int saleNo, DateTime fileMTimeUtc) =>
        EstimateSaleDate(year, saleNo) ?? fileMTimeUtc;

    /// <summary>Same lookup as SaleDateFor, minus the file-mtime fallback — meaningless for
    /// a hypothetical sale number with no file at all, which is exactly the case
    /// SalesInMonth needs (enumerating a whole month's calendar including weeks that
    /// haven't happened yet). Null means genuinely unknown for this year.</summary>
    private static DateTime? EstimateSaleDate(int year, int saleNo)
    {
        if (YearSaleDates.TryGetValue(year, out var dates) && dates.TryGetValue(saleNo, out var date))
            return date;
        if (YearAnchors.TryGetValue(year, out var anchor))
            return anchor.Date.AddDays((saleNo - anchor.SaleNo) * 7);
        return null;
    }

    /// <summary>Colombo tea auctions run at most ~53 sales/year (weekly) — a safe upper
    /// bound to scan when enumerating a month's calendar.</summary>
    private const int MaxSaleNoPerYear = 53;

    public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month)
    {
        var result = new List<(int, DateTime)>();
        for (var saleNo = 1; saleNo <= MaxSaleNoPerYear; saleNo++)
        {
            var date = EstimateSaleDate(year, saleNo);
            if (date is { } d && d.Year == year && d.Month == month)
                result.Add((saleNo, d));
        }
        return result.OrderBy(x => x.Item1).ToList();
    }

    // ---- mark code index ---------------------------------------------------------------

    // Only leading zeros are normalized (MF01257 -> MF1257 — brokers pad differently for the
    // same estate); any trailing letter is kept, since it can distinguish a genuinely
    // different mark sharing a code block (confirmed live: "GREEN MOUNT" is MF1188, "GREEN
    // MOUNT SUPER" is MF1188A — not necessarily the same mark; a base-number merge was tried
    // and reverted — see SharedMarkCatalogueService's own doc comment for the full story).
    // Mirrors SharedMarkCatalogueService.NormalizeMarkCode; duplicated rather than shared
    // because Services deliberately doesn't depend on the feature modules built on top of it.
    private static string NormalizeMarkCode(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        var m = System.Text.RegularExpressions.Regex.Match(trimmed, @"^([A-Z]+)0*(\d+[A-Z]*)$");
        return m.Success ? $"{m.Groups[1].Value}{m.Groups[2].Value}" : trimmed;
    }

    private readonly object _markCodeIndexLock = new();
    private (HashSet<Guid> IndexedIds, Dictionary<string, (string Name, string Elevation)> Index)? _markCodeIndex;

    private sealed class MarkCodeIndexFile
    {
        public HashSet<Guid> IndexedCatalogueIds { get; set; } = [];
        public Dictionary<string, MarkCodeEntry> Index { get; set; } = new();
    }
    private sealed class MarkCodeEntry
    {
        public string Name { get; set; } = "";
        public string Elevation { get; set; } = "";
    }

    // v2: NormalizeMarkCode briefly stripped the trailing letter too (base factory number
    // only) for a factory-wide merge that was later reverted (see SharedMarkCatalogueService's
    // doc comment). v3: reverted back to keeping the trailing letter, so v2's keys (base
    // number only) no longer match anything callers look up — bumping the filename abandons
    // the stale file and lets a fresh one build under the restored key shape, the same
    // "just re-parse once" pattern SaleCachePath uses.
    private string MarkCodeIndexPath => Path.Combine(CacheDir, "mark-code-index-v3.json");

    /// <summary>Builds/extends the index in memory + on disk, then returns it. Only
    /// catalogues not already folded in get parsed (via the normal GetLots path, so a
    /// catalogue already sale-cached on disk is cheap) — after the first call in this
    /// process (or the first call ever, if the persisted file already covers everything),
    /// this is a dictionary lookup, not a multi-year scan.</summary>
    public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex()
    {
        lock (_markCodeIndexLock)
        {
            var (indexedIds, index) = _markCodeIndex ??= LoadMarkCodeIndexFromDisk();

            var newCatalogues = ListCatalogues().Where(c => !indexedIds.Contains(c.Id)).ToList();
            if (newCatalogues.Count > 0)
            {
                foreach (var cat in newCatalogues)
                {
                    foreach (var lot in GetLots(cat.Id) ?? [])
                    {
                        if (string.IsNullOrWhiteSpace(lot.Mark) || string.IsNullOrWhiteSpace(lot.SellingMark) ||
                            string.IsNullOrWhiteSpace(lot.Elevation)) continue;
                        var code = NormalizeMarkCode(lot.Mark);
                        if (!index.ContainsKey(code))
                            index[code] = (lot.SellingMark.Trim(), lot.Elevation);
                    }
                    indexedIds.Add(cat.Id);
                }
                SaveMarkCodeIndexToDisk(indexedIds, index);
                _markCodeIndex = (indexedIds, index);
            }

            return new Dictionary<string, (string Name, string Elevation)>(index, StringComparer.OrdinalIgnoreCase);
        }
    }

    private (HashSet<Guid>, Dictionary<string, (string Name, string Elevation)>) LoadMarkCodeIndexFromDisk()
    {
        try
        {
            var path = MarkCodeIndexPath;
            if (File.Exists(path))
            {
                var file = JsonSerializer.Deserialize<MarkCodeIndexFile>(File.ReadAllText(path));
                if (file is not null)
                {
                    var index = file.Index.ToDictionary(
                        kv => kv.Key, kv => (kv.Value.Name, kv.Value.Elevation), StringComparer.OrdinalIgnoreCase);
                    return (file.IndexedCatalogueIds, index);
                }
            }
        }
        catch
        {
            // Corrupt/unreadable index — rebuild from scratch below rather than fail the request.
        }
        return ([], new Dictionary<string, (string Name, string Elevation)>(StringComparer.OrdinalIgnoreCase));
    }

    private void SaveMarkCodeIndexToDisk(HashSet<Guid> indexedIds, Dictionary<string, (string Name, string Elevation)> index)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var file = new MarkCodeIndexFile
            {
                IndexedCatalogueIds = indexedIds,
                Index = index.ToDictionary(kv => kv.Key, kv => new MarkCodeEntry { Name = kv.Value.Name, Elevation = kv.Value.Elevation }),
            };
            var path = MarkCodeIndexPath;
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(file));
            File.Move(tmp, path, overwrite: true);
        }
        catch
        {
            // Cache is an optimization — never fail a request because it couldn't be written.
        }
    }

    // ---- public surface --------------------------------------------------------------

    public IReadOnlyList<Catalogue> ListCatalogues()
    {
        EnsureMetaLoaded();
        var result = new List<Catalogue>();
        var anyStale = false;
        foreach (var file in ScanFiles())
        {
            var key = (file.Year, file.SaleNo);
            SaleMeta? meta;
            lock (_mapLock)
            {
                meta = _meta.TryGetValue(key, out var m) && m.Sig == file.Sig ? m.Meta : null;
            }
            if (meta is null) anyStale = true;
            result.Add(new Catalogue
            {
                Id = CatalogueIdFor(file.Year, file.SaleNo),
                Year = file.Year,
                SourceName = $"Sale {file.SaleNo} - {file.Year}",
                // Row count / headers are known once the sale has been parsed at least once
                // (the warm pass, an opportunistic re-warm below, or first open); until then
                // the sale still lists, just bare.
                RowCount = meta?.RowCount ?? 0,
                Headers = meta?.Headers ?? new List<string>(),
                ImportedAt = SaleDateFor(file.Year, file.SaleNo, new DateTime(file.Sig.MTimeTicks, DateTimeKind.Utc)),
            });
        }
        // A file with no meta entry is either brand new or was replaced on disk (different
        // size/mtime) since it was last parsed — SaleMetaWarmer only runs once at startup, so
        // without this a sale edited/replaced while the app is already running would list as
        // 0 lots until someone happened to open it or the app restarted. Non-blocking: this
        // request still returns immediately with whatever's known now; the next ListCatalogues
        // call sees the corrected count once the background pass catches up.
        if (anyStale) TriggerBackgroundWarm();
        return result.OrderByDescending(c => c.ImportedAt).ToList();
    }

    private void TriggerBackgroundWarm()
    {
        if (Interlocked.CompareExchange(ref _warmInFlight, 1, 0) != 0) return;
        _ = Task.Run(() =>
        {
            try { WarmMeta(); }
            finally { Interlocked.Exchange(ref _warmInFlight, 0); }
        });
    }

    /// <summary>The next unused sale number for a given year — the highest on disk in that
    /// year + 1 (or 1 when that year has no files yet). Lets a file that isn't named by sale
    /// number still be imported: it slots in as the next sale, keeping the deterministic-id
    /// / weekly-sequence identity intact.</summary>
    public int NextSaleNumber(int year)
    {
        var files = ScanFiles().Where(f => f.Year == year).ToList();
        return files.Count == 0 ? 1 : files.Max(f => f.SaleNo) + 1;
    }

    public Catalogue? GetCatalogue(Guid id) => LoadByCatalogueId(id)?.Catalogue;

    public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => LoadByCatalogueId(catalogueId)?.Lots;

    public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId)
    {
        var saleNo = SaleNoOfLotId(lotId);
        var files = ScanFiles();

        // Legacy ids never carry a year hint (bytes 2-3 are hash noise for them), so the
        // legacy flat-root file is always tried first — this exactly preserves lookup
        // behavior for every id that existed before years did.
        var legacy = files.FirstOrDefault(f => f.IsLegacy && f.SaleNo == saleNo);
        if (legacy is not null)
        {
            var sale = LoadSale(legacy);
            if (sale.ById.TryGetValue(lotId, out var lot)) return (lot, sale.Catalogue);
        }

        // Not a legacy id (or the legacy sale doesn't have it) — try the year folded into
        // bytes 2-3. A wrong/garbage hint just misses the ById lookup below and falls through.
        var yearHint = YearHintOfLotId(lotId);
        var foldered = files.FirstOrDefault(f => !f.IsLegacy && f.Year == yearHint && f.SaleNo == saleNo);
        if (foldered is null) return null;
        var foldSale = LoadSale(foldered);
        return foldSale.ById.TryGetValue(lotId, out var foldLot) ? (foldLot, foldSale.Catalogue) : null;
    }

    public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId)
    {
        var file = ScanFiles().FirstOrDefault(f => CatalogueIdFor(f.Year, f.SaleNo) == catalogueId);
        if (file is null) return Array.Empty<ValuedLotSlim>();
        var key = (file.Year, file.SaleNo);

        lock (_mapLock)
        {
            if (_slims.TryGetValue(key, out var hit) && hit.Sig == file.Sig) return hit.Rows;
        }

        // Try the slim cache file; else derive it from the (cached or parsed) full sale.
        var fromDisk = ReadCache<List<ValuedLotSlim>>(SlimCachePath(file.Year, file.SaleNo), file.Sig);
        var rows = fromDisk?.ToArray() ?? BuildSlim(LoadSale(file).Lots);
        if (fromDisk is null) WriteCache(SlimCachePath(file.Year, file.SaleNo), file.Sig, rows.ToList());

        lock (_mapLock) _slims[key] = (file.Sig, rows);
        return rows;
    }

    /// <summary>
    /// The warm pass the listing comment promises: load every sale whose row count/headers
    /// aren't known yet (cached sales in ~1–2s, brand-new files via a full parse), so no
    /// sale sits in the list showing 0 lots. Runs in the background at startup; the small
    /// LRU keeps memory bounded while it walks the folder.
    /// </summary>
    public void WarmMeta(CancellationToken ct = default)
    {
        EnsureMetaLoaded();
        foreach (var file in ScanFiles())
        {
            if (ct.IsCancellationRequested) return;
            bool known;
            lock (_mapLock)
                known = _meta.TryGetValue((file.Year, file.SaleNo), out var m) && m.Sig == file.Sig;
            if (known) continue;
            try
            {
                LoadSale(file);
            }
            catch
            {
                // One unreadable file shouldn't stop the rest of the pass; the sale just
                // lists bare until its file is fixed.
            }
        }
    }

    // ---- loading ---------------------------------------------------------------------

    private LoadedSale? LoadByCatalogueId(Guid catalogueId)
    {
        var file = ScanFiles().FirstOrDefault(f => CatalogueIdFor(f.Year, f.SaleNo) == catalogueId);
        return file is null ? null : LoadSale(file);
    }

    private LoadedSale LoadSale(SaleFile file)
    {
        var key = (file.Year, file.SaleNo);
        lock (_mapLock)
        {
            if (_loaded.TryGetValue(key, out var hit) && hit.Sig == file.Sig)
            {
                hit.Touch = ++_touchCounter;
                return hit;
            }
        }

        // Per-sale load lock: parallel requests for the same sale parse once; requests for
        // other (already loaded) sales aren't blocked behind a 25s parse.
        object saleLock;
        lock (_mapLock) saleLock = _saleLocks.TryGetValue(key, out var l) ? l : _saleLocks[key] = new object();

        lock (saleLock)
        {
            lock (_mapLock)
            {
                if (_loaded.TryGetValue(key, out var hit) && hit.Sig == file.Sig)
                {
                    hit.Touch = ++_touchCounter;
                    return hit;
                }
            }

            var cached = ReadCache<CachedSale>(SaleCachePath(file.Year, file.SaleNo), file.Sig);
            Catalogue catalogue;
            List<Lot> lots;
            if (cached is not null)
            {
                (catalogue, lots) = (cached.Catalogue, cached.Lots);
            }
            else
            {
                (catalogue, lots) = ParseSale(file);
                WriteCache(SaleCachePath(file.Year, file.SaleNo), file.Sig,
                    new CachedSale { Catalogue = catalogue, Lots = lots });
                WriteCache(SlimCachePath(file.Year, file.SaleNo), file.Sig, BuildSlim(lots).ToList());
            }

            var sale = new LoadedSale
            {
                Sig = file.Sig,
                Catalogue = catalogue,
                Lots = lots,
                ById = lots.ToDictionary(l => l.Id),
                Touch = ++_touchCounter,
            };

            lock (_mapLock)
            {
                _loaded[key] = sale;
                RecordMeta(file, catalogue);
                // Keep only the most recently used sales in memory — each holds ~12k lots.
                foreach (var evict in _loaded.OrderByDescending(kv => kv.Value.Touch).Skip(MaxLoadedSales).Select(kv => kv.Key).ToList())
                    _loaded.Remove(evict);
            }
            return sale;
        }
    }

    /// <summary>Parse the Excel file into a catalogue + lots with deterministic ids, the
    /// company's Valuation column applied, and per-grade classification backfill.</summary>
    private (Catalogue Catalogue, List<Lot> Lots) ParseSale(SaleFile file)
    {
        using var stream = File.OpenRead(file.Path);
        var parsed = importer.ParseFile(stream, Path.GetFileName(file.Path));
        var rows = parsed.Rows.Where(r => !string.IsNullOrWhiteSpace(r.GetValueOrDefault("Lot No"))).ToList();

        var importedAt = SaleDateFor(file.Year, file.SaleNo, new DateTime(file.Sig.MTimeTicks, DateTimeKind.Utc));
        var catalogueId = CatalogueIdFor(file.Year, file.SaleNo);
        var catalogue = new Catalogue
        {
            Id = catalogueId,
            Year = file.Year,
            SourceName = $"Sale {file.SaleNo} - {file.Year}",
            Headers = parsed.Headers,
            RowCount = rows.Count,
            ColumnMeta = importer.BuildColumnMeta(parsed.Headers, rows),
            ImportedAt = importedAt,
        };

        var seenKeys = new Dictionary<string, int>();
        var lots = rows.Select(row =>
        {
            var lot = importer.BuildLot(catalogueId, parsed.Headers, row);
            // Duplicate identical rows share a row key — suffix repeats so every lot id is
            // unique yet stable for the same file content.
            if (seenKeys.TryGetValue(lot.RowKey, out var n))
            {
                seenKeys[lot.RowKey] = n + 1;
                lot.RowKey = $"{lot.RowKey}#{n + 1}";
            }
            else seenKeys[lot.RowKey] = 0;
            lot.Id = LotIdFor(file.Year, file.SaleNo, lot.RowKey);
            lot.SaleNo = file.SaleNo.ToString();
            lot.SaleYear = file.Year.ToString();
            lot.Valuation = ParseValuation(row.GetValueOrDefault("Valuation", ""), importedAt);
            return lot;
        }).ToList();

        BackfillClassifications(lots);
        return (catalogue, lots);
    }

    private static ValuedLotSlim[] BuildSlim(List<Lot> lots) =>
        lots.Where(l => l.Valuation is not null)
            .Select(l => new ValuedLotSlim(l.Id, l.RowKey, l.Grade, l.Valuation!))
            .ToArray();

    // ---- the company's valuations from the files -------------------------------------

    /// <summary>"900" or "1200-1300" (commas tolerated) → a Valuation; anything else → null.</summary>
    private static Valuation? ParseValuation(string raw, DateTime at)
    {
        var text = raw.Trim().Replace(",", "");
        if (text == "") return null;
        var parts = text.Split('-', StringSplitOptions.TrimEntries);
        if (parts.Length == 2 && decimal.TryParse(parts[0], out var from) && decimal.TryParse(parts[1], out var to) && from < to)
            return new Valuation { ValuationFrom = from, ValuationTo = to, UpdatedAt = at };
        return decimal.TryParse(text, out var single)
            ? new Valuation { ValuationSingle = single, UpdatedAt = at }
            : null;
    }

    /// <summary>
    /// The files carry the company's valuations but no classification column, so each sale
    /// gets a backfill on load: within each grade, the valued lots split by value into the
    /// four tiers at the 25/55/80 percentiles (Poor | BelowBest | Best | SelectBest) — the
    /// same band proportions the taster's contiguous scale uses. Equal values always land
    /// on one tier. Real classifications entered in the app override these via the stored
    /// valuation overlay.
    /// </summary>
    private static void BackfillClassifications(List<Lot> lots)
    {
        var valued = lots.Where(l => l.Valuation?.EffectiveValue is not null && !string.IsNullOrWhiteSpace(l.Grade));
        foreach (var grade in valued.GroupBy(l => l.Grade!.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var ordered = grade.OrderBy(l => l.Valuation!.EffectiveValue).ToList();
            int done = 0;
            foreach (var group in ordered.GroupBy(l => l.Valuation!.EffectiveValue))
            {
                int size = group.Count();
                var tier = TierFor((done + size / 2.0) / ordered.Count);
                foreach (var lot in group) lot.Valuation!.Classification = tier;
                done += size;
            }
        }
    }

    private static Classification TierFor(double pos) =>
        pos < 0.25 ? Classification.Poor
        : pos < 0.55 ? Classification.BelowBest
        : pos < 0.80 ? Classification.Best
        : Classification.SelectBest;

    // ---- folder scanning & meta ------------------------------------------------------

    /// <summary>Every sale file currently in data/sales — the folder is the source of
    /// truth, so a newly dropped file (e.g. 31.xlsx next week) appears immediately. Files
    /// sitting flat in the root, and files under a data/sales/2026/ subfolder, are both the
    /// legacy 2026 namespace and hash identically (CatalogueIdFor/LotIdFor dispatch off the
    /// year value alone, not the file's path) — 2026 can live in either location, or split
    /// across both, with no effect on existing ids. Any other numbered subfolder
    /// (data/sales/2025/…) belongs to that year under the new year-folded hash scheme.</summary>
    private List<SaleFile> ScanFiles()
    {
        if (!Directory.Exists(SalesDir)) return new List<SaleFile>();
        var result = new List<SaleFile>();

        void ScanDir(string dir, int year)
        {
            foreach (var path in Directory.GetFiles(dir, "*.xls*"))
            {
                var digits = new string(Path.GetFileNameWithoutExtension(path).Where(char.IsDigit).ToArray());
                if (digits.Length is 0 or > 3 || !int.TryParse(digits, out var saleNo)) continue;
                var info = new FileInfo(path);
                result.Add(new SaleFile(year, saleNo, path, new Signature(info.Length, info.LastWriteTimeUtc.Ticks)));
            }
        }

        ScanDir(SalesDir, LegacyYear);
        foreach (var dir in Directory.GetDirectories(SalesDir))
        {
            if (!int.TryParse(Path.GetFileName(dir), out var year)) continue;
            ScanDir(dir, year);
        }

        // Same (year, sale number) twice (e.g. 05.xlsx and 05.xls) — keep the newest file.
        return result
            .GroupBy(f => (f.Year, f.SaleNo))
            .Select(g => g.OrderByDescending(f => f.Sig.MTimeTicks).First())
            .OrderBy(f => f.Year).ThenBy(f => f.SaleNo)
            .ToList();
    }

    private void RecordMeta(SaleFile file, Catalogue catalogue)
    {
        // Merge with the meta already on disk before writing — this used to skip the load,
        // so the first sale opened after a restart rewrote meta.json with only itself and
        // every other sale listed as 0 lots until re-opened.
        EnsureMetaLoaded();
        _meta[(file.Year, file.SaleNo)] = (file.Sig, new SaleMeta { RowCount = catalogue.RowCount, Headers = catalogue.Headers });
        try
        {
            Directory.CreateDirectory(CacheDir);
            File.WriteAllText(MetaPath(), JsonSerializer.Serialize(
                _meta.ToDictionary(
                    kv => $"{kv.Key.Year}:{kv.Key.SaleNo}",
                    kv => new { kv.Value.Sig.Size, kv.Value.Sig.MTimeTicks, kv.Value.Meta.RowCount, kv.Value.Meta.Headers })));
        }
        catch
        {
            // Meta is a listing nicety — never fail a request over it.
        }
    }

    private void EnsureMetaLoaded()
    {
        lock (_mapLock)
        {
            if (_metaFileLoaded) return;
            _metaFileLoaded = true;
            try
            {
                if (!File.Exists(MetaPath())) return;
                var doc = JsonSerializer.Deserialize<Dictionary<string, MetaEntry>>(File.ReadAllText(MetaPath()));
                if (doc is null) return;
                foreach (var (key, e) in doc)
                {
                    // Pre-year meta.json used bare sale-number keys ("28"); read those back
                    // as legacy 2026 entries rather than forcing a cold re-warm on upgrade.
                    var parts = key.Split(':');
                    (int Year, int SaleNo)? parsed = parts.Length == 2 && int.TryParse(parts[0], out var y) && int.TryParse(parts[1], out var s)
                        ? (y, s)
                        : int.TryParse(key, out var legacySaleNo) ? (LegacyYear, legacySaleNo) : null;
                    if (parsed is { } k)
                        _meta[k] = (new Signature(e.Size, e.MTimeTicks), new SaleMeta { RowCount = e.RowCount, Headers = e.Headers ?? new() });
                }
            }
            catch
            {
                // Corrupt meta cache — sales just list bare until re-parsed.
            }
        }
    }

    private sealed class MetaEntry
    {
        public long Size { get; set; }
        public long MTimeTicks { get; set; }
        public int RowCount { get; set; }
        public List<string>? Headers { get; set; }
    }

    // ---- gzip JSON cache -------------------------------------------------------------

    // Bump this whenever the Lot/Catalogue shape changes so old cache files (which would
    // otherwise silently deserialize with nulls for any newly-added field) are ignored and
    // every sale transparently re-parses once, on its next request — no manual cache-clearing
    // step needed. v2: added SellingMark/Status/PurchasedPrice/Buyer/BuyerName to Lot.
    // v3: added Factory/FactoryName to Lot. v5: cache keys became (year, saleNo) composite.
    // v6: added IsReprint to Lot.
    private const string CacheSchemaVersion = "v6";

    private string MetaPath() => Path.Combine(CacheDir, "meta.json");
    private string SaleCachePath(int year, int saleNo) => Path.Combine(CacheDir, $"sale-{CacheSchemaVersion}-{year}-{saleNo}.json.gz");
    private string SlimCachePath(int year, int saleNo) => Path.Combine(CacheDir, $"valued-{CacheSchemaVersion}-{year}-{saleNo}.json.gz");

    private sealed class CacheEnvelope<T>
    {
        public long Size { get; set; }
        public long MTimeTicks { get; set; }
        public T Payload { get; set; } = default!;
    }

    private static T? ReadCache<T>(string path, Signature sig) where T : class
    {
        try
        {
            if (!File.Exists(path)) return null;
            using var fs = File.OpenRead(path);
            using var gz = new GZipStream(fs, CompressionMode.Decompress);
            var envelope = JsonSerializer.Deserialize<CacheEnvelope<T>>(gz);
            if (envelope is null || envelope.Size != sig.Size || envelope.MTimeTicks != sig.MTimeTicks) return null;
            return envelope.Payload;
        }
        catch
        {
            return null; // unreadable cache → fall back to a fresh parse
        }
    }

    private void WriteCache<T>(string path, Signature sig, T payload)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var tmp = path + ".tmp";
            using (var fs = File.Create(tmp))
            using (var gz = new GZipStream(fs, CompressionLevel.Fastest))
            {
                JsonSerializer.Serialize(gz, new CacheEnvelope<T> { Size = sig.Size, MTimeTicks = sig.MTimeTicks, Payload = payload });
            }
            File.Move(tmp, path, overwrite: true);
        }
        catch
        {
            // Cache is an optimization — never fail a request because it couldn't be written.
        }
    }
}

/// <summary>Runs the store's warm pass in the background at startup so every sale lists
/// with its real lot count instead of 0 while never having been opened.</summary>
public class SaleMetaWarmer(SaleFileStore store) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.Run(() => store.WarmMeta(stoppingToken), stoppingToken);
}
