using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

public record MslScanSummary(
    int FilesImported,
    int RowsImported,
    int FilesUpToDate,
    int FilesRemoved,
    List<string> Errors,
    TimeSpan Elapsed);

/// <summary>
/// Imports the data/msl archive into MongoDB, incrementally and idempotently: each data
/// file's (size, mtime) is tracked in MslFileState, so a scan only re-imports what changed
/// — dropping a new sale folder in and rescanning imports just that sale. Re-importing a
/// file first deletes its previous rows (keyed by SourceFile), so repeated scans never
/// duplicate. Deleting a file from the folder removes its rows on the next scan.
/// </summary>
public class MslImportService(MongoContext db, IConfiguration config, IWebHostEnvironment env, MslRollupService rollups, MslEnrichmentService enrichment, ILogger<MslImportService> logger)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public DateTime? LastScanAt { get; private set; }
    public MslScanSummary? LastSummary { get; private set; }

    /// <summary>Bumped whenever a scan changed data — cache keys include it, so heavy
    /// status/aggregate results stay cached until an import actually lands.</summary>
    public int DataVersion => _dataVersion;
    private int _dataVersion;

    /// <summary>For out-of-band data changes (e.g. startup Excel enrichment) that must
    /// invalidate the analytics caches without a file import.</summary>
    public void BumpDataVersion() => Interlocked.Increment(ref _dataVersion);

    /// <summary>Resolved MSL data root. Configurable (Msl:DataPath) for deployment; in
    /// development it finds the repo's data/msl by walking up from the content root.</summary>
    public string? DataPath => _dataPath ??= ResolveDataPath();
    private string? _dataPath;

    private string? ResolveDataPath()
    {
        var configured = config["Msl:DataPath"];
        if (!string.IsNullOrWhiteSpace(configured))
            return Directory.Exists(configured) ? Path.GetFullPath(configured) : null;
        var dir = new DirectoryInfo(env.ContentRootPath);
        for (int i = 0; i < 6 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "data", "msl");
            if (Directory.Exists(candidate)) return candidate;
        }
        return null;
    }

    public async Task<MslScanSummary> ScanAsync(bool force = false, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var started = DateTime.UtcNow;
            var root = DataPath;
            if (root is null)
            {
                var missing = new MslScanSummary(0, 0, 0, 0,
                    ["MSL data folder not found — set Msl:DataPath or create data/msl."], TimeSpan.Zero);
                LastSummary = missing;
                return missing;
            }

            var known = (await db.MslFiles.Find(FilterDefinition<MslFileState>.Empty).ToListAsync(ct))
                .ToDictionary(f => f.RelativePath);
            var seen = new HashSet<string>();
            var affectedSales = new HashSet<(int Year, int SaleNo)>();
            int imported = 0, rows = 0, upToDate = 0;
            var errors = new List<string>();

            foreach (var file in EnumerateDataFiles(root))
            {
                ct.ThrowIfCancellationRequested();
                var rel = Path.GetRelativePath(root, file.FullName).Replace('\\', '/');
                seen.Add(rel);
                if (!force && known.TryGetValue(rel, out var state) &&
                    state.Length == file.Length && state.LastWriteUtc == TruncateToMs(file.LastWriteTimeUtc) &&
                    state.Error is null)
                {
                    upToDate++;
                    continue;
                }
                try
                {
                    var count = await ImportFileAsync(file, rel, affectedSales, ct);
                    imported++;
                    rows += count;
                    await SaveStateAsync(rel, file, count, null, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "MSL import failed for {File}", rel);
                    errors.Add($"{rel}: {ex.Message}");
                    await SaveStateAsync(rel, file, 0, ex.Message, ct);
                }
            }

            // Files that vanished from the folder: remove their rows + state (noting which
            // sales lose rows so their rollups rebuild too).
            int removed = 0;
            foreach (var gone in known.Keys.Where(k => !seen.Contains(k)))
            {
                foreach (var sale in await db.AuctionLots.Find(l => l.SourceFile == gone)
                             .Project(l => new { l.SaleYear, l.SaleNo }).ToListAsync(ct))
                    affectedSales.Add((sale.SaleYear, sale.SaleNo));
                await db.AuctionLots.DeleteManyAsync(l => l.SourceFile == gone, ct);
                await db.TeaBoardAverages.DeleteManyAsync(t => t.SourceFile == gone, ct);
                await db.MslFiles.DeleteOneAsync(f => f.RelativePath == gone, ct);
                removed++;
            }

            if (affectedSales.Count > 0)
            {
                // Re-imported rows lost their Excel-joined fields — enrich BEFORE the
                // rollups so bags/packing land, then rebuild the materialized stats.
                await enrichment.EnrichAsync(affectedSales, ct);
                await rollups.RebuildForSalesAsync(affectedSales, ct);
            }

            var summary = new MslScanSummary(imported, rows, upToDate, removed, errors, DateTime.UtcNow - started);
            LastScanAt = DateTime.UtcNow;
            LastSummary = summary;
            if (imported > 0 || removed > 0) Interlocked.Increment(ref _dataVersion);
            if (imported > 0 || removed > 0)
                logger.LogInformation(
                    "MSL scan: {Imported} file(s) imported ({Rows} rows), {Removed} removed, {UpToDate} unchanged in {Elapsed:g}",
                    imported, rows, removed, upToDate, summary.Elapsed);
            return summary;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Data files a scan considers: broker TXTs under auction/, PVT TXTs under
    /// private-sales/, and the table PDFs directly under tea-board/ (scans/ holds image
    /// circulars with no extractable text; _review holds unclassified leftovers).</summary>
    private static IEnumerable<FileInfo> EnumerateDataFiles(string root)
    {
        var auction = new DirectoryInfo(Path.Combine(root, "auction"));
        if (auction.Exists)
            foreach (var f in auction.EnumerateFiles("*.TXT", SearchOption.AllDirectories)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;

        var pvt = new DirectoryInfo(Path.Combine(root, "private-sales"));
        if (pvt.Exists)
            foreach (var f in pvt.EnumerateFiles("*.TXT", SearchOption.TopDirectoryOnly)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;

        var teaBoard = new DirectoryInfo(Path.Combine(root, "tea-board"));
        if (teaBoard.Exists)
            foreach (var f in teaBoard.EnumerateFiles("*.pdf", SearchOption.TopDirectoryOnly)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;
    }

    private async Task<int> ImportFileAsync(FileInfo file, string rel, ISet<(int Year, int SaleNo)> affectedSales, CancellationToken ct)
    {
        if (rel.StartsWith("tea-board/", StringComparison.OrdinalIgnoreCase))
        {
            var averages = TeaBoardPdfParser.ParseFile(file.FullName, rel);
            await db.TeaBoardAverages.DeleteManyAsync(t => t.SourceFile == rel, ct);
            if (averages.Count > 0)
                await db.TeaBoardAverages.InsertManyAsync(averages, cancellationToken: ct);
            return averages.Count;
        }

        var isPrivate = rel.StartsWith("private-sales/", StringComparison.OrdinalIgnoreCase);
        MslTxtParser.ParseResult parsed;
        await using (var stream = file.OpenRead())
            parsed = MslTxtParser.ParseFile(stream, isPrivate);

        foreach (var l in parsed.Lots)
        {
            affectedSales.Add((l.SaleDate.Year, l.SaleNo));
            // Private files previously imported under a synthetic sale 0 — rebuild that
            // bucket too so its stale rollups are cleared on re-import.
            if (isPrivate) affectedSales.Add((l.SaleDate.Year, 0));
        }

        await db.AuctionLots.DeleteManyAsync(l => l.SourceFile == rel, ct);
        foreach (var batch in parsed.Lots.Chunk(4000))
        {
            ct.ThrowIfCancellationRequested();
            await db.AuctionLots.InsertManyAsync(batch.Select(l => new AuctionLot
            {
                SaleYear = l.SaleDate.Year,
                SaleNo = l.SaleNo,
                SaleDate = l.SaleDate,
                Broker = l.Broker,
                IsPrivate = l.IsPrivate,
                LotNo = l.LotNo,
                Invoice = l.Invoice,
                FactoryCode = l.FactoryCode,
                SellingMark = l.SellingMark,
                Grade = l.Grade,
                QuantityKg = l.QuantityKg,
                PriceRs = l.PriceRs,
                Sold = l.PriceRs > 0,
                BuyerCode = l.BuyerCode,
                BuyerName = l.BuyerName,
                EstateName = l.EstateName,
                DistrictCode = l.DistrictCode,
                MslCode = l.MslCode,
                ElevationCode = l.ElevationCode,
                ClassCode = l.ClassCode,
                RefuseTea = l.RefuseTea,
                SourceFile = rel,
            }), new InsertManyOptions { IsOrdered = false }, ct);
        }
        if (parsed.SkippedLines > 0)
            logger.LogDebug("MSL {File}: {Skipped} unparseable line(s) skipped", rel, parsed.SkippedLines);
        return parsed.Lots.Count;
    }

    /// <summary>BSON DateTimes carry millisecond precision while NTFS mtimes carry
    /// 100-ns ticks — both sides of the change check must truncate identically or every
    /// file looks modified on every scan and the whole archive re-imports each time.</summary>
    private static DateTime TruncateToMs(DateTime t) =>
        new(t.Ticks - t.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

    private Task SaveStateAsync(string rel, FileInfo file, int rowCount, string? error, CancellationToken ct) =>
        db.MslFiles.ReplaceOneAsync(
            f => f.RelativePath == rel,
            new MslFileState
            {
                RelativePath = rel,
                Length = file.Length,
                LastWriteUtc = TruncateToMs(file.LastWriteTimeUtc),
                ImportedAt = DateTime.UtcNow,
                RowCount = rowCount,
                Error = error,
            },
            new ReplaceOptions { IsUpsert = true },
            ct);
}
