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
}

/// <summary>One valued lot, reduced to what classification history needs.</summary>
public record ValuedLotSlim(Guid LotId, string RowKey, string? Grade, Valuation Valuation);

/// <summary>
/// Reads the company's weekly-sale Excel files straight from data/sales — the files ARE
/// the catalogue store (the database only holds user-entered valuations). Files are named
/// by sale number (01.xlsx … 30.xlsx); dropping next week's file into the folder is all it
/// takes for the sale to appear — the folder is rescanned on every listing.
///
/// A 35MB market file takes ~25s to parse, so each parse is cached under data/.cache as
/// gzipped JSON keyed by the file's size+mtime: full reloads take ~1–2s and survive
/// restarts, and an edited/replaced file re-parses automatically. Recently used sales stay
/// in memory (small LRU); a slim valued-lots extract per sale is kept separately so
/// classification history never needs 29 full sales in memory.
///
/// All ids are deterministic (MD5 of sale number / row key), so lot references and stored
/// valuations stay valid across restarts and cache rebuilds. A lot id embeds its sale
/// number in the first two bytes, so an id alone is enough to find the right file.
/// </summary>
public class SaleFileStore(CatalogueImportService importer, IWebHostEnvironment env) : ICatalogueSource
{
    /// <summary>Sale 28 runs in the next auction week; every sale is anchored a week apart from it.</summary>
    private static readonly DateTime Sale28Date = new(2026, 7, 21, 9, 30, 0, DateTimeKind.Utc);
    private const int MaxLoadedSales = 4;

    private readonly object _mapLock = new();
    private readonly Dictionary<int, object> _saleLocks = new();
    private readonly Dictionary<int, LoadedSale> _loaded = new();
    private readonly Dictionary<int, (Signature Sig, ValuedLotSlim[] Rows)> _slims = new();
    private readonly Dictionary<int, (Signature Sig, SaleMeta Meta)> _meta = new();
    private long _touchCounter;
    private bool _metaFileLoaded;

    private sealed record Signature(long Size, long MTimeTicks);
    private sealed record SaleFile(int SaleNo, string Path, Signature Sig);
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

    public static Guid CatalogueIdFor(int saleNo) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes($"sale:{saleNo}")));

    /// <summary>Lot id = MD5 of sale + row key, with the sale number stamped into the
    /// first two bytes so the id alone identifies which file to load.</summary>
    public static Guid LotIdFor(int saleNo, string rowKey)
    {
        var hash = MD5.HashData(Encoding.UTF8.GetBytes($"lot:{saleNo}:{rowKey}"));
        hash[0] = (byte)(saleNo & 0xFF);
        hash[1] = (byte)((saleNo >> 8) & 0xFF);
        return new Guid(hash);
    }

    private static int SaleNoOfLotId(Guid lotId)
    {
        var b = lotId.ToByteArray();
        return b[0] | (b[1] << 8);
    }

    private static DateTime SaleDateFor(int saleNo) => Sale28Date.AddDays((saleNo - 28) * 7);

    // ---- public surface --------------------------------------------------------------

    public IReadOnlyList<Catalogue> ListCatalogues()
    {
        EnsureMetaLoaded();
        var result = new List<Catalogue>();
        foreach (var file in ScanFiles())
        {
            SaleMeta? meta;
            lock (_mapLock)
            {
                meta = _meta.TryGetValue(file.SaleNo, out var m) && m.Sig == file.Sig ? m.Meta : null;
            }
            result.Add(new Catalogue
            {
                Id = CatalogueIdFor(file.SaleNo),
                SourceName = $"Sale {file.SaleNo} - 2026",
                // Row count / headers are known once the sale has been parsed at least once
                // (the warm pass or first open); until then the sale still lists, just bare.
                RowCount = meta?.RowCount ?? 0,
                Headers = meta?.Headers ?? new List<string>(),
                ImportedAt = SaleDateFor(file.SaleNo),
            });
        }
        return result.OrderByDescending(c => c.ImportedAt).ToList();
    }

    /// <summary>The next unused sale number — the highest on disk + 1 (or 1 when the folder
    /// is empty). Lets a file that isn't named by sale number still be imported: it slots in
    /// as the next sale, keeping the deterministic-id / weekly-sequence identity intact.</summary>
    public int NextSaleNumber()
    {
        var files = ScanFiles();
        return files.Count == 0 ? 1 : files.Max(f => f.SaleNo) + 1;
    }

    public Catalogue? GetCatalogue(Guid id) => LoadByCatalogueId(id)?.Catalogue;

    public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => LoadByCatalogueId(catalogueId)?.Lots;

    public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId)
    {
        var saleNo = SaleNoOfLotId(lotId);
        var file = ScanFiles().FirstOrDefault(f => f.SaleNo == saleNo);
        if (file is null) return null;
        var sale = LoadSale(file);
        return sale.ById.TryGetValue(lotId, out var lot) ? (lot, sale.Catalogue) : null;
    }

    public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId)
    {
        var file = ScanFiles().FirstOrDefault(f => CatalogueIdFor(f.SaleNo) == catalogueId);
        if (file is null) return Array.Empty<ValuedLotSlim>();

        lock (_mapLock)
        {
            if (_slims.TryGetValue(file.SaleNo, out var hit) && hit.Sig == file.Sig) return hit.Rows;
        }

        // Try the slim cache file; else derive it from the (cached or parsed) full sale.
        var fromDisk = ReadCache<List<ValuedLotSlim>>(SlimCachePath(file.SaleNo), file.Sig);
        var rows = fromDisk?.ToArray() ?? BuildSlim(LoadSale(file).Lots);
        if (fromDisk is null) WriteCache(SlimCachePath(file.SaleNo), file.Sig, rows.ToList());

        lock (_mapLock) _slims[file.SaleNo] = (file.Sig, rows);
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
                known = _meta.TryGetValue(file.SaleNo, out var m) && m.Sig == file.Sig;
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
        var file = ScanFiles().FirstOrDefault(f => CatalogueIdFor(f.SaleNo) == catalogueId);
        return file is null ? null : LoadSale(file);
    }

    private LoadedSale LoadSale(SaleFile file)
    {
        lock (_mapLock)
        {
            if (_loaded.TryGetValue(file.SaleNo, out var hit) && hit.Sig == file.Sig)
            {
                hit.Touch = ++_touchCounter;
                return hit;
            }
        }

        // Per-sale load lock: parallel requests for the same sale parse once; requests for
        // other (already loaded) sales aren't blocked behind a 25s parse.
        object saleLock;
        lock (_mapLock) saleLock = _saleLocks.TryGetValue(file.SaleNo, out var l) ? l : _saleLocks[file.SaleNo] = new object();

        lock (saleLock)
        {
            lock (_mapLock)
            {
                if (_loaded.TryGetValue(file.SaleNo, out var hit) && hit.Sig == file.Sig)
                {
                    hit.Touch = ++_touchCounter;
                    return hit;
                }
            }

            var cached = ReadCache<CachedSale>(SaleCachePath(file.SaleNo), file.Sig);
            Catalogue catalogue;
            List<Lot> lots;
            if (cached is not null)
            {
                (catalogue, lots) = (cached.Catalogue, cached.Lots);
            }
            else
            {
                (catalogue, lots) = ParseSale(file);
                WriteCache(SaleCachePath(file.SaleNo), file.Sig,
                    new CachedSale { Catalogue = catalogue, Lots = lots });
                WriteCache(SlimCachePath(file.SaleNo), file.Sig, BuildSlim(lots).ToList());
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
                _loaded[file.SaleNo] = sale;
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

        var importedAt = SaleDateFor(file.SaleNo);
        var catalogueId = CatalogueIdFor(file.SaleNo);
        var catalogue = new Catalogue
        {
            Id = catalogueId,
            SourceName = $"Sale {file.SaleNo} - 2026",
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
            lot.Id = LotIdFor(file.SaleNo, lot.RowKey);
            lot.SaleNo = file.SaleNo.ToString();
            lot.SaleYear = "2026";
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
    /// truth, so a newly dropped file (e.g. 31.xlsx next week) appears immediately.</summary>
    private List<SaleFile> ScanFiles()
    {
        if (!Directory.Exists(SalesDir)) return new List<SaleFile>();
        var result = new List<SaleFile>();
        foreach (var path in Directory.GetFiles(SalesDir, "*.xls*"))
        {
            var digits = new string(Path.GetFileNameWithoutExtension(path).Where(char.IsDigit).ToArray());
            if (digits.Length is 0 or > 3 || !int.TryParse(digits, out var saleNo)) continue;
            var info = new FileInfo(path);
            result.Add(new SaleFile(saleNo, path, new Signature(info.Length, info.LastWriteTimeUtc.Ticks)));
        }
        // Same sale number twice (e.g. 05.xlsx and 05.xls) — keep the newest file.
        return result
            .GroupBy(f => f.SaleNo)
            .Select(g => g.OrderByDescending(f => f.Sig.MTimeTicks).First())
            .OrderBy(f => f.SaleNo)
            .ToList();
    }

    private void RecordMeta(SaleFile file, Catalogue catalogue)
    {
        // Merge with the meta already on disk before writing — this used to skip the load,
        // so the first sale opened after a restart rewrote meta.json with only itself and
        // every other sale listed as 0 lots until re-opened.
        EnsureMetaLoaded();
        _meta[file.SaleNo] = (file.Sig, new SaleMeta { RowCount = catalogue.RowCount, Headers = catalogue.Headers });
        try
        {
            Directory.CreateDirectory(CacheDir);
            File.WriteAllText(MetaPath(), JsonSerializer.Serialize(
                _meta.ToDictionary(
                    kv => kv.Key.ToString(),
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
                    if (int.TryParse(key, out var saleNo))
                        _meta[saleNo] = (new Signature(e.Size, e.MTimeTicks), new SaleMeta { RowCount = e.RowCount, Headers = e.Headers ?? new() });
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

    private string MetaPath() => Path.Combine(CacheDir, "meta.json");
    private string SaleCachePath(int saleNo) => Path.Combine(CacheDir, $"sale-{saleNo}.json.gz");
    private string SlimCachePath(int saleNo) => Path.Combine(CacheDir, $"valued-{saleNo}.json.gz");

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
