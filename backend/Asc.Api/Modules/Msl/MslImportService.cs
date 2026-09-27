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
                await db.FactoryAverages.DeleteManyAsync(f => f.SourceFile == gone, ct);
                await db.GradeAnalysis.DeleteManyAsync(g => g.SourceFile == gone, ct);
                await db.PlantationRankings.DeleteManyAsync(p => p.SourceFile == gone, ct);
                await db.CombinedAverages.DeleteManyAsync(c => c.SourceFile == gone, ct);
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

        // Monthly "Factory Wise Averages" reports (one text file per month; PDFs of the same reports
        // and the other report kinds — grade analysis, combined averages, plantation ranking — sit
        // alongside in their own folders and are archived, not imported).
        var factoryAverages = new DirectoryInfo(Path.Combine(root, "factory-averages"));
        if (factoryAverages.Exists)
            foreach (var f in factoryAverages.EnumerateFiles("factory-averages-*.txt", SearchOption.AllDirectories)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;

        // Grade analysis and plantation ranking reports: the monthly text files (and the all-elevations /
        // overall summaries). Their PDFs and the combined-averages reports are archived, not imported.
        var gradeAnalysis = new DirectoryInfo(Path.Combine(root, "grade-analysis"));
        if (gradeAnalysis.Exists)
            foreach (var f in gradeAnalysis.EnumerateFiles("grade-analysis-*.txt", SearchOption.AllDirectories)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;
        var plantationRanking = new DirectoryInfo(Path.Combine(root, "plantation-ranking"));
        if (plantationRanking.Exists)
            foreach (var f in plantationRanking.EnumerateFiles("plantation-ranking-*.txt", SearchOption.AllDirectories)
                         .OrderBy(f => f.FullName, StringComparer.OrdinalIgnoreCase))
                yield return f;

        // Combined (gross) averages: the full monthly reports. The "-asia-siyaka" files are extracts of one
        // broker's pages that the full report already contains, so they stay archive-only.
        var combinedAverages = new DirectoryInfo(Path.Combine(root, "combined-averages"));
        if (combinedAverages.Exists)
            foreach (var f in combinedAverages.EnumerateFiles("combined-averages-*.txt", SearchOption.AllDirectories)
                         .Where(f => !f.Name.Contains("-asia-siyaka", StringComparison.OrdinalIgnoreCase))
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
            if (averages.Count == 0) return 0;

            // One month, one set of rows. A "~2" copy (a second document for the same month —
            // often the only one with a text layer when the base file is a scan) only fills a
            // month the base file left empty; a base file that yields rows replaces any copy.
            var (year, month) = TeaBoardPdfParser.PeriodOf(file.Name)!.Value;
            if (TeaBoardPdfParser.IsAlternateCopy(file.Name))
            {
                if (await db.TeaBoardAverages.Find(t => t.Year == year && t.Month == month && t.SourceFile != rel).AnyAsync(ct))
                    return 0;
            }
            else
            {
                await db.TeaBoardAverages.DeleteManyAsync(t => t.Year == year && t.Month == month && t.SourceFile != rel, ct);
            }
            await db.TeaBoardAverages.InsertManyAsync(averages, cancellationToken: ct);
            return averages.Count;
        }

        if (rel.StartsWith("factory-averages/", StringComparison.OrdinalIgnoreCase))
            return await ImportFactoryAveragesAsync(file, rel, ct);
        if (rel.StartsWith("grade-analysis/", StringComparison.OrdinalIgnoreCase))
            return await ImportGradeAnalysisAsync(file, rel, ct);
        if (rel.StartsWith("plantation-ranking/", StringComparison.OrdinalIgnoreCase))
            return await ImportPlantationRankingAsync(file, rel, ct);
        if (rel.StartsWith("combined-averages/", StringComparison.OrdinalIgnoreCase))
            return await ImportCombinedAveragesAsync(file, rel, ct);

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

    /// <summary>
    /// One monthly Factory Wise Averages report. The month comes from the report's own title, not the
    /// file name. A "~N" copy only fills a month no other file has already supplied; a base file
    /// replaces any copy. A report in an older layout (no recognisable title) imports zero rows.
    /// Internal inconsistencies in a report (its printed totals not matching its factories) are
    /// logged, not rejected — a few source reports have them.
    /// </summary>
    private async Task<int> ImportFactoryAveragesAsync(FileInfo file, string rel, CancellationToken ct)
    {
        var parsed = Asc.Api.Modules.Msl.FactoryAverages.FactoryAveragesParser.Parse(
            Asc.Api.Modules.Msl.FactoryAverages.FactoryAveragesParser.DecodeText(await File.ReadAllBytesAsync(file.FullName, ct)), rel);
        await db.FactoryAverages.DeleteManyAsync(f => f.SourceFile == rel, ct);
        if (parsed is null)
        {
            logger.LogInformation("Factory averages {File}: not a recognised report layout — archived only", rel);
            return 0;
        }

        var (year, month) = (parsed.Year, parsed.Month);
        if (file.Name.Contains('~'))
        {
            if (await db.FactoryAverages.Find(f => f.Year == year && f.Month == month && f.SourceFile != rel).AnyAsync(ct))
                return 0;
        }
        else
        {
            await db.FactoryAverages.DeleteManyAsync(f => f.Year == year && f.Month == month && f.SourceFile != rel, ct);
        }

        foreach (var problem in Asc.Api.Modules.Msl.FactoryAverages.FactoryAveragesParser.Reconcile(parsed))
            logger.LogWarning("Factory averages {Year}-{Month:00} ({File}) is not internally consistent: {Problem}", year, month, rel, problem);

        await db.FactoryAverages.InsertManyAsync(parsed.Rows, cancellationToken: ct);
        return parsed.Rows.Count;
    }

    /// <summary>One monthly grade-analysis report (or its all-elevations summary). Rows are replaced per file;
    /// a report whose grades don't add up to its own printed totals is logged, not rejected.</summary>
    private async Task<int> ImportGradeAnalysisAsync(FileInfo file, string rel, CancellationToken ct)
    {
        var parsed = Asc.Api.Modules.Msl.GradeAnalysis.GradeAnalysisParser.Parse(
            Asc.Api.Modules.Msl.GradeAnalysis.GradeAnalysisParser.DecodeText(await File.ReadAllBytesAsync(file.FullName, ct)), rel);
        await db.GradeAnalysis.DeleteManyAsync(g => g.SourceFile == rel, ct);
        if (parsed is null)
        {
            logger.LogInformation("Grade analysis {File}: not a recognised report layout — archived only", rel);
            return 0;
        }
        foreach (var problem in Asc.Api.Modules.Msl.GradeAnalysis.GradeAnalysisParser.Reconcile(parsed))
            logger.LogWarning("Grade analysis {Year}-{Month:00} ({File}) is not internally consistent: {Problem}", parsed.Year, parsed.Month, rel, problem);
        await db.GradeAnalysis.InsertManyAsync(parsed.Rows, cancellationToken: ct);
        return parsed.Rows.Count;
    }

    /// <summary>One monthly plantation-ranking ("Performance of Companies") report; rows are replaced per file.</summary>
    private async Task<int> ImportPlantationRankingAsync(FileInfo file, string rel, CancellationToken ct)
    {
        var parsed = Asc.Api.Modules.Msl.PlantationRanking.PlantationRankingParser.Parse(
            Asc.Api.Modules.Msl.PlantationRanking.PlantationRankingParser.DecodeText(await File.ReadAllBytesAsync(file.FullName, ct)), rel);
        await db.PlantationRankings.DeleteManyAsync(p => p.SourceFile == rel, ct);
        if (parsed is null)
        {
            logger.LogInformation("Plantation ranking {File}: not a recognised report layout — archived only", rel);
            return 0;
        }
        foreach (var problem in Asc.Api.Modules.Msl.PlantationRanking.PlantationRankingParser.Reconcile(parsed))
            logger.LogWarning("Plantation ranking {Year}-{Month:00} ({File}) is not internally consistent: {Problem}", parsed.Year, parsed.Month, rel, problem);
        await db.PlantationRankings.InsertManyAsync(parsed.Rows, cancellationToken: ct);
        return parsed.Rows.Count;
    }

    /// <summary>One monthly combined (gross) averages report; rows are replaced per file.</summary>
    private async Task<int> ImportCombinedAveragesAsync(FileInfo file, string rel, CancellationToken ct)
    {
        var parsed = Asc.Api.Modules.Msl.CombinedAverages.CombinedAveragesParser.Parse(
            Asc.Api.Modules.Msl.CombinedAverages.CombinedAveragesParser.DecodeText(await File.ReadAllBytesAsync(file.FullName, ct)), rel);
        await db.CombinedAverages.DeleteManyAsync(c => c.SourceFile == rel, ct);
        if (parsed is null)
        {
            logger.LogInformation("Combined averages {File}: not a recognised report layout — archived only", rel);
            return 0;
        }
        foreach (var problem in Asc.Api.Modules.Msl.CombinedAverages.CombinedAveragesParser.Reconcile(parsed))
            logger.LogWarning("Combined averages {Year}-{Month:00} ({File}) is not internally consistent: {Problem}", parsed.Year, parsed.Month, rel, problem);
        foreach (var batch in parsed.Rows.Chunk(2000))
        {
            ct.ThrowIfCancellationRequested();
            await db.CombinedAverages.InsertManyAsync(batch, cancellationToken: ct);
        }
        return parsed.Rows.Count;
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
