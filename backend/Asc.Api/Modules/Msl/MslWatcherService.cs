using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// The "drop a file in, everything updates" automation. On startup it runs a full scan
/// (which is incremental — unchanged files are skipped via MslFileState), then watches the
/// data/msl folder for changes. File events are debounced: copying a week's 8 broker files
/// raises dozens of change events, so the watcher waits for the folder to go quiet for a
/// few seconds and then runs one scan covering everything that arrived.
/// </summary>
public class MslWatcherService(MslImportService importer, MslRollupService rollups, MslReferenceService reference, MslEnrichmentService enrichment, Asc.Api.Data.MongoContext db, ILogger<MslWatcherService> logger) : BackgroundService
{
    private static readonly TimeSpan Quiet = TimeSpan.FromSeconds(4);
    private FileSystemWatcher? _watcher;
    private long _pendingSince; // UtcNow ticks of the newest event; 0 = nothing pending

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Initial scan — also the full backfill on first run against an empty database.
        try
        {
            await importer.ScanAsync(ct: stoppingToken);
            // Rollups for sales imported before rollups existed (or after a wiped stats
            // collection) — incremental imports handle their own rebuilds inside ScanAsync.
            await rollups.RebuildMissingAsync(ct: stoppingToken);

            // Warm the current year's documents into WiredTiger's cache: the Analysis
            // screen's cross-filter queries are year-scoped by default, and pulling this
            // year off disk lazily costs seconds on the first filter click otherwise.
            var year = DateTime.UtcNow.Year;
            var warmed = await db.AuctionLots.Find(l => l.SaleYear == year)
                .Project(l => new { l.QuantityKg })
                .ToListAsync(stoppingToken);
            logger.LogInformation("MSL cache warmed: {Count} lots of {Year} paged in", warmed.Count, year);

            // Build the factory→group reference now (parses every sale Excel once) so the
            // first Analysis request doesn't pay ~50s for the lazy build.
            _ = reference.ByFactory;

            // Bags/packing enrichment from the sale Excels for any sale not yet enriched;
            // enriched data must invalidate the analytics caches.
            if (await enrichment.EnrichAsync(ct: stoppingToken) > 0)
                importer.BumpDataVersion();
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The app itself is shutting down — not a failure, nothing to log or recover from.
        }
        catch (Exception ex)
        {
            // Must catch even OperationCanceledException-derived types here: a MongoDB call
            // that times out or gets canceled for reasons unrelated to app shutdown (load,
            // a transient network hiccup) throws TaskCanceledException too, and `ex is not
            // OperationCanceledException` used to let that slip through uncaught — which
            // BackgroundService's default StopHost behavior turns into the ENTIRE API host
            // going down over one background rollup rebuild. Confirmed in production: a
            // RebuildMissingAsync TaskCanceledException crashed the whole app on 2026-08-16.
            logger.LogError(ex, "Initial MSL scan failed");
        }

        var root = importer.DataPath;
        if (root is null)
        {
            logger.LogWarning("MSL data folder not found — watcher disabled. Set Msl:DataPath or create data/msl.");
            return;
        }

        _watcher = new FileSystemWatcher(root)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            EnableRaisingEvents = true,
        };
        FileSystemEventHandler onEvent = (_, e) => Touch(e.FullPath);
        _watcher.Created += onEvent;
        _watcher.Changed += onEvent;
        _watcher.Deleted += onEvent;
        _watcher.Renamed += (_, e) => Touch(e.FullPath);
        logger.LogInformation("MSL watcher active on {Root}", root);

        // Catch-up pass: files changed during the startup window (initial scan → warming →
        // reference build → enrichment) happened before EnableRaisingEvents and were never
        // seen. Queue one scan now — costs under a second when nothing actually changed.
        Interlocked.Exchange(ref _pendingSince, DateTime.UtcNow.Ticks - Quiet.Ticks);

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            var since = Interlocked.Read(ref _pendingSince);
            if (since == 0 || DateTime.UtcNow.Ticks - since < Quiet.Ticks) continue;
            Interlocked.Exchange(ref _pendingSince, 0);
            try
            {
                var summary = await importer.ScanAsync(ct: stoppingToken);
                if (summary.FilesImported > 0 || summary.FilesRemoved > 0)
                    logger.LogInformation("MSL auto-import: {Files} file(s), {Rows} rows",
                        summary.FilesImported, summary.RowsImported);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // App shutdown mid-scan — not a failure.
            }
            catch (Exception ex)
            {
                // Same reasoning as the initial-scan catch above: a non-shutdown
                // TaskCanceledException must not be allowed to propagate and crash the host.
                logger.LogError(ex, "MSL auto-import failed");
            }
        }
    }

    private void Touch(string fullPath)
    {
        // Only data files matter; editor temp files and the manifest shouldn't trigger scans.
        var ext = Path.GetExtension(fullPath);
        if (!ext.Equals(".txt", StringComparison.OrdinalIgnoreCase) &&
            !ext.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return;
        Interlocked.Exchange(ref _pendingSince, DateTime.UtcNow.Ticks);
    }

    public override void Dispose()
    {
        _watcher?.Dispose();
        base.Dispose();
        GC.SuppressFinalize(this);
    }
}
