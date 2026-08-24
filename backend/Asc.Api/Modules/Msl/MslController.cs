using System.IO.Compression;
using System.Text.RegularExpressions;
using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

public record AuctionLotDto(
    int SaleYear, int SaleNo, DateTime SaleDate, string? Broker, string? BrokerName,
    bool IsPrivate, string LotNo, string? Invoice, string FactoryCode, string SellingMark,
    string Grade, decimal QuantityKg, decimal PriceRs, bool Sold, string? BuyerCode,
    string? BuyerName, string EstateName, string? MslCode, string? ElevationCode,
    string? Elevation, bool RefuseTea);

public record MslSearchAggregateDto(
    long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg, decimal? WeightedAvgRs,
    decimal? MinPriceRs, decimal? MaxPriceRs);

public record MslSearchResultDto(List<AuctionLotDto> Items, long Total, MslSearchAggregateDto Aggregate);

public record MslAggregateRowDto(
    string Key, long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg,
    decimal? WeightedAvgRs, decimal? MinPriceRs, decimal? MaxPriceRs);

public record MslYearStatDto(int Year, int Sales, long Lots);

/// <summary>A year whose public-auction sale numbers have gaps — e.g. sale 27 never
/// arrived while 26 and 28 did. Computed from actual imported (non-private) lots, so it
/// reflects what's really in the database, not just which folders exist on disk.</summary>
public record MslGapDto(int Year, int MaxSaleNo, List<int> MissingSaleNos);

public record MslStatusDto(
    string? DataPath, long TotalLots, long PrivateLots, int TrackedFiles, int FilesWithErrors,
    DateTime? LastScanAt, MslScanSummary? LastScan, List<MslYearStatDto> Years, int TeaBoardMonths,
    List<MslGapDto> Gaps);

/// <summary>One file's outcome in a batch upload — kind (auction vs. private), year, sale
/// and broker are all read back out of the file's own rows (the same way the importer
/// itself works), not parsed from the filename or a zip entry's path, since the corpus has
/// known filename typos. <paramref name="SourceZip"/> is set when this file was extracted
/// from an uploaded .ZIP rather than uploaded directly.</summary>
public record MslBatchFileResultDto(
    string FileName, string? SourceZip, string? Kind, string? Broker, int? Year, int? SaleNo, int Rows, string? Error);
public record MslBatchUploadResultDto(List<MslBatchFileResultDto> Files, MslScanSummary Scan);

/// <summary>One candidate file waiting in a staged upload-batch review list — the same
/// detected kind/broker/year/sale as <see cref="MslBatchFileResultDto"/>, plus a row-count
/// preview and a same-destination conflict warning, so the admin can drop anything they
/// don't want before a single row reaches the database. <paramref name="StagingId"/> is what
/// the commit call references to say "keep this one".</summary>
public record MslStagedFileDto(
    string StagingId, string FileName, string? SourceZip, string? Kind, string? Broker,
    int? Year, int? SaleNo, int Rows, string? Error, bool WillReplace, string? ReplaceDetail,
    bool RequiresConfirmation, string? ConfirmToken);
public record MslStageBatchResultDto(string BatchId, List<MslStagedFileDto> Files, DateTime ExpiresAtUtc);
public record MslCommitBatchRequestDto(string BatchId, List<string> Keep);

/// <summary>One file already in the archive — the Admin Panel's "browse archive files" list,
/// for reviewing or removing something that was imported previously (not just at upload
/// time). Kind/year/sale are parsed back out of the relative path itself here, since that's
/// exactly how the importer laid the file out in the first place — see
/// MslImportService.EnumerateDataFiles / MslController.Upload's placement rules.</summary>
public record MslTrackedFileDto(
    string RelativePath, string Kind, int? Year, int? SaleNo, long Length,
    DateTime LastWriteUtc, DateTime ImportedAt, int RowCount, string? Error);

public record SaleComparisonDiffDto(
    string Broker, string LotNo, string SellingMark, string Grade,
    decimal? ExcelPrice, decimal MslPrice, string Kind);

public record SaleComparisonDto(
    int SaleYear, int SaleNo, int ExcelLots, int MslLots, int Joined,
    int PriceAgreements, List<SaleComparisonDiffDto> Differences);

public record TeaBoardRowDto(
    int Year, int Month, string Section, string Elevation,
    decimal? MonthQtyKg, decimal? MonthAvgRs, decimal? TodateQtyKg, decimal? TodateAvgRs);

/// <summary>
/// Master search over the imported MSL archive: every auction lot 2013–present plus the
/// yearly private-sale files and the Tea Board monthly averages. The sale-comparison
/// endpoint joins MSL rows against the weekly sale Excel catalogues (ICatalogueSource) on
/// (broker, lot no) — the verified 99.7% join — surfacing post-auction corrections.
/// </summary>
[ApiController]
[Route("api/v1/msl")]
[Authorize]
public class MslController(
    MongoContext db, MslImportService importer, ICatalogueSource catalogues, IMemoryCache cache,
    IAuditLogger audit, MslUploadStagingService staging) : ControllerBase
{
    /// <summary>Heavy whole-collection results (status, aggregates) are cached keyed on the
    /// importer's DataVersion — instant on repeat views, recomputed only after an import
    /// actually changes data (or the entry ages out).</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    private Task<T> Cached<T>(string key, Func<Task<T>> compute) =>
        cache.GetOrCreateAsync($"msl:{importer.DataVersion}:{key}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return compute();
        })!;

    [HttpGet("status")]
    public Task<MslStatusDto> Status() => Cached("status", ComputeStatus);

    private async Task<MslStatusDto> ComputeStatus()
    {
        var files = await db.MslFiles.Find(FilterDefinition<MslFileState>.Empty).ToListAsync();
        var total = await db.AuctionLots.EstimatedDocumentCountAsync();
        var priv = await db.AuctionLots.CountDocumentsAsync(l => l.IsPrivate);

        // Two-stage pipeline (per-sale, then per-year) rather than Distinct()-inside-group,
        // which the driver's LINQ translator doesn't support.
        var yearDocs = await db.AuctionLots.Aggregate<BsonDocument>(new[]
        {
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = new BsonDocument { ["y"] = "$y", ["s"] = "$s" },
                ["lots"] = new BsonDocument("$sum", 1),
            }),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = "$_id.y",
                ["sales"] = new BsonDocument("$sum", 1),
                ["lots"] = new BsonDocument("$sum", "$lots"),
            }),
            new BsonDocument("$sort", new BsonDocument("_id", 1)),
        }).ToListAsync();
        var years = yearDocs.Select(d => new
        {
            Year = d["_id"].ToInt32(),
            Sales = d["sales"].ToInt32(),
            Lots = d["lots"].ToInt64(),
        }).ToList();

        var tbMonths = (await db.TeaBoardAverages.Aggregate()
            .Group(t => new { t.Year, t.Month }, g => new { g.Key })
            .ToListAsync()).Count;

        return new MslStatusDto(
            importer.DataPath, total, priv, files.Count, files.Count(f => f.Error is not null),
            importer.LastScanAt, importer.LastSummary,
            years.Select(y => new MslYearStatDto(y.Year, y.Sales, y.Lots)).ToList(),
            tbMonths, await ComputeGapsAsync());
    }

    /// <summary>Missing public-auction sale numbers per year — e.g. sale 27/2024 never
    /// arrived while 26 and 28 did (confirmed 22 Aug 2026, root cause: the sale's broker
    /// files were never added to data/msl). Built from IsPrivate==false lots specifically:
    /// a sale can have private-sale rows (synthetic SaleNo 0 bucket aside) without ever
    /// having received its real auction files, which is exactly the case that slipped
    /// through undetected until a manual cross-check against the portal caught it.</summary>
    private async Task<List<MslGapDto>> ComputeGapsAsync()
    {
        var saleDocs = await db.AuctionLots.Aggregate<BsonDocument>(new[]
        {
            new BsonDocument("$match", new BsonDocument("pv", false)),
            new BsonDocument("$group", new BsonDocument { ["_id"] = new BsonDocument { ["y"] = "$y", ["s"] = "$s" } }),
        }).ToListAsync();

        return saleDocs
            .GroupBy(d => d["_id"]["y"].ToInt32())
            .Select(g =>
            {
                var present = g.Select(d => d["_id"]["s"].ToInt32()).Where(s => s > 0).ToHashSet();
                var max = present.Count > 0 ? present.Max() : 0;
                var missing = Enumerable.Range(1, max).Where(n => !present.Contains(n)).ToList();
                return new MslGapDto(g.Key, max, missing);
            })
            .Where(gap => gap.MissingSaleNos.Count > 0)
            .OrderByDescending(gap => gap.Year)
            .ToList();
    }

    /// <summary>Manual rescan — the folder watcher already does this automatically; this
    /// is for "I just changed files and don't want to wait" and for force re-imports.
    /// Admin-only: a force rescan re-imports the whole multi-million-row archive.</summary>
    [HttpPost("rescan")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<MslScanSummary>> Rescan([FromQuery] bool force = false, CancellationToken ct = default)
        => await importer.ScanAsync(force, ct);

    /// <summary>
    /// Admin upload for the MSL archive (see data/msl/README.md's "Adding new data" routine
    /// — this is that same manual drop-a-file-in-the-right-folder step, done from the Admin
    /// Panel instead of a filesystem copy). Placement is exactly what the README documents:
    /// auction broker files go under auction/&lt;year&gt;/sale-&lt;NN&gt;/ (the importer reads
    /// the actual sale year/number back out of each file's rows, so this folder is purely
    /// organizational — see MslImportService.ImportFileAsync), private-sale files replace
    /// private-sales/PVT&lt;yy&gt;.TXT, and Tea Board reports are saved under tea-board/ by a
    /// fixed name. The folder watcher would pick any of these up within a few seconds
    /// regardless; a scan is triggered immediately here so the admin sees the result now.
    /// </summary>
    [HttpPost("upload")]
    [RequestSizeLimit(20_000_000)]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<MslScanSummary>> Upload(
        IFormFile file, [FromForm] string type, CancellationToken ct,
        [FromForm] int? year = null, [FromForm] int? saleNo = null, [FromForm] int? month = null)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");
        var root = importer.DataPath;
        if (root is null) return BadRequest("MSL data folder not found — set Msl:DataPath or create data/msl.");

        var ext = Path.GetExtension(file.FileName);
        string targetPath;
        string relForAudit;

        switch (type)
        {
            case "auction":
                if (!string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
                    return BadRequest("Auction sale broker files are .TXT (fixed-width, 199 chars/line).");
                if (year is null or < 2000 or > 2100) return BadRequest("Enter a valid year.");
                if (saleNo is null or < 1 or > 60) return BadRequest("Enter a valid sale number (1-60).");
                var auctionDir = Path.Combine(root, "auction", year.ToString()!, $"sale-{saleNo:00}");
                Directory.CreateDirectory(auctionDir);
                targetPath = Path.Combine(auctionDir, file.FileName);
                relForAudit = $"auction/{year}/sale-{saleNo:00}/{file.FileName}";
                break;

            case "private":
                if (!string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
                    return BadRequest("Private-sale files are .TXT.");
                var pvtDir = Path.Combine(root, "private-sales");
                Directory.CreateDirectory(pvtDir);
                targetPath = Path.Combine(pvtDir, file.FileName);
                relForAudit = $"private-sales/{file.FileName}";
                break;

            case "teaboard":
                if (!string.Equals(ext, ".pdf", StringComparison.OrdinalIgnoreCase))
                    return BadRequest("Tea Board reports are .pdf.");
                if (year is null or < 2000 or > 2100) return BadRequest("Enter a valid year.");
                if (month is null or < 1 or > 12) return BadRequest("Enter a valid month (1-12).");
                var tbDir = Path.Combine(root, "tea-board");
                Directory.CreateDirectory(tbDir);
                var tbName = $"national-averages-{year:0000}-{month:00}.pdf";
                targetPath = Path.Combine(tbDir, tbName);
                relForAudit = $"tea-board/{tbName}";
                break;

            default:
                return BadRequest($"Unknown upload type '{type}'. Use 'auction', 'private' or 'teaboard'.");
        }

        await using (var stream = System.IO.File.Create(targetPath))
        {
            await file.CopyToAsync(stream, ct);
        }

        var summary = await importer.ScanAsync(force: false, ct);
        await audit.LogAsync(User, "msl.uploaded", "MslFile", relForAudit, $"{file.FileName}, {file.Length:N0} bytes", ct);
        return Ok(summary);
    }

    /// <summary>Step 1 of the upload-batch review flow: drop in any mix of broker .TXT
    /// files, PVT private-sale .TXT files, and .ZIP archives containing either. Every
    /// candidate is content-sniffed with a full parse — kind (public/private), broker, year,
    /// sale number and a real row-count preview, the same way an actual import would read it
    /// — and flagged if it would overwrite an already-tracked archive file or collide with
    /// another file in this same batch. Nothing here touches data/msl or MongoDB: the bytes
    /// land in a scratch folder (see MslUploadStagingService) and wait for the admin to
    /// review the list and drop anything they don't want before <see cref="CommitBatch"/>
    /// actually imports the rest. Zip entries are capped in count and size as a zip-bomb
    /// guard.</summary>
    [HttpPost("upload-batch/stage")]
    [RequestSizeLimit(150_000_000)]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<MslStageBatchResultDto>> StageBatch(List<IFormFile> files, CancellationToken ct)
    {
        if (files is null || files.Count == 0) return BadRequest("No files uploaded.");
        var root = importer.DataPath;
        if (root is null) return BadRequest("MSL data folder not found — set Msl:DataPath or create data/msl.");

        const long MaxEntryBytes = 20_000_000;
        const long MaxZipTotalBytes = 200_000_000;
        const int MaxZipEntries = 500;

        var (batchId, stagingDir) = staging.BeginBatch();
        var staged = new List<MslStagedFileDto>();

        static MslStagedFileDto Rejected(string fileName, string? sourceZip, string error) =>
            new(Guid.NewGuid().ToString("N"), fileName, sourceZip, null, null, null, null, 0, error, false, null, false, null);

        // Pass 1: flatten the upload into plain .TXT candidates sitting in this batch's
        // scratch folder, expanding any .ZIP in place, so a zip of broker/private files and
        // a folder of loose files go through identical detection logic below.
        var candidates = new List<(string FileName, string? SourceZip, string TempPath)>();

        foreach (var file in files)
        {
            var ext = Path.GetExtension(file.FileName);
            if (string.Equals(ext, ".zip", StringComparison.OrdinalIgnoreCase))
            {
                var zipTemp = Path.Combine(stagingDir, $"{Guid.NewGuid():N}.zip");
                await using (var dest = System.IO.File.Create(zipTemp))
                    await file.CopyToAsync(dest, ct);

                try
                {
                    using var archive = ZipFile.OpenRead(zipTemp);
                    if (archive.Entries.Count > MaxZipEntries)
                    {
                        staged.Add(Rejected(file.FileName, null,
                            $"Zip has {archive.Entries.Count} entries — over the {MaxZipEntries} limit, skipped entirely."));
                    }
                    else
                    {
                        long total = 0;
                        foreach (var entry in archive.Entries)
                        {
                            var name = entry.Name; // path-less; folder entries come through as ""
                            if (string.IsNullOrEmpty(name)) continue;
                            if (name.StartsWith("._", StringComparison.Ordinal) ||
                                entry.FullName.Contains("__MACOSX", StringComparison.OrdinalIgnoreCase))
                                continue; // macOS zip junk

                            if (!string.Equals(Path.GetExtension(name), ".txt", StringComparison.OrdinalIgnoreCase))
                            {
                                staged.Add(Rejected(name, file.FileName, "Not a .TXT file — skipped."));
                                continue;
                            }
                            if (entry.Length > MaxEntryBytes)
                            {
                                staged.Add(Rejected(name, file.FileName,
                                    $"{entry.Length:N0} bytes — over the {MaxEntryBytes:N0} byte per-file limit, skipped."));
                                continue;
                            }
                            total += entry.Length;
                            if (total > MaxZipTotalBytes)
                            {
                                staged.Add(Rejected(name, file.FileName,
                                    "Skipped — this zip's total extracted size went over the batch limit."));
                                continue;
                            }

                            var entryTemp = Path.Combine(stagingDir, $"{Guid.NewGuid():N}.txt");
                            await using (var entryStream = entry.Open())
                            await using (var entryDest = System.IO.File.Create(entryTemp))
                                await entryStream.CopyToAsync(entryDest, ct);
                            candidates.Add((name, file.FileName, entryTemp));
                        }
                    }
                }
                catch (InvalidDataException)
                {
                    staged.Add(Rejected(file.FileName, null, "Couldn't read this as a .ZIP file — it may be corrupt."));
                }
                finally
                {
                    System.IO.File.Delete(zipTemp);
                }
                continue;
            }

            if (!string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
            {
                staged.Add(Rejected(file.FileName, null, "Not a .TXT or .ZIP file — skipped."));
                continue;
            }

            var tempPath = Path.Combine(stagingDir, $"{Guid.NewGuid():N}.txt");
            await using (var dest = System.IO.File.Create(tempPath))
                await file.CopyToAsync(dest, ct);
            candidates.Add((file.FileName, null, tempPath));
        }

        // Pass 2: a full parse (not just a first-line peek) — kind, year, sale number,
        // broker and a real row-count preview all come from the file itself.
        var detected = new List<(string FileName, string? SourceZip, string TempPath, string? Kind,
            string? Broker, int? Year, int? SaleNo, int Rows, string? TargetRelPath)>();

        foreach (var c in candidates)
        {
            MslTxtParser.ParseResult parsed;
            await using (var stream = System.IO.File.OpenRead(c.TempPath))
                parsed = MslTxtParser.ParseFile(stream, isPrivateFile: false);

            if (parsed.Lots.Count == 0)
            {
                staged.Add(Rejected(c.FileName, c.SourceZip,
                    "Couldn't find a valid sale row in this file — check it's a genuine broker or private-sale TXT export."));
                continue;
            }

            var first = parsed.Lots[0];
            var kind = first.IsPrivate ? "private" : "auction";
            var targetRel = first.IsPrivate
                ? $"private-sales/PVT{first.SaleDate.Year % 100:00}.TXT"
                : $"auction/{first.SaleDate.Year}/sale-{first.SaleNo:00}/{c.FileName}";
            detected.Add((c.FileName, c.SourceZip, c.TempPath, kind, first.Broker, first.SaleDate.Year,
                first.IsPrivate ? null : first.SaleNo, parsed.Lots.Count, targetRel));
        }

        // Conflict check: same destination as an already-tracked archive file, or collided
        // with by another file in this very batch — either way the admin needs to know
        // before one silently overwrites the other, and the "remove" list is how they fix it.
        var relPaths = detected.Select(d => d.TargetRelPath!).Distinct().ToList();
        var existing = relPaths.Count > 0
            ? (await db.MslFiles.Find(f => relPaths.Contains(f.RelativePath)).ToListAsync(ct)).ToDictionary(f => f.RelativePath)
            : [];
        var dupCounts = detected.GroupBy(d => d.TargetRelPath!).ToDictionary(g => g.Key, g => g.Count());

        foreach (var d in detected)
        {
            bool willReplace = false, requiresConfirmation = false;
            string? detail = null, confirmToken = null;
            if (dupCounts[d.TargetRelPath!] > 1)
            {
                willReplace = true;
                detail = "Another file in this upload targets the same destination — only one will survive; remove one of them.";
            }
            else if (existing.TryGetValue(d.TargetRelPath!, out var state))
            {
                willReplace = true;
                if (d.Kind == "private" && state.RowCount > 0 && d.Rows < state.RowCount * 0.5)
                {
                    // A private-sale upload replaces the WHOLE year's accumulating file, not
                    // just adds to it — losing most of a year's rows to an accidental partial
                    // upload is exactly the mistake this guard exists to catch (confirmed by
                    // a real incident on 23 Aug 2026: an 8-file batch correctly added Sale
                    // 32/2026's broker files, but one file detected as private silently wiped
                    // 14,801 rows down to 35). Typing the year is a deliberate-intent check,
                    // not a security boundary — this endpoint is already Admin-only.
                    requiresConfirmation = true;
                    confirmToken = d.Year.ToString();
                    detail = $"This file has only {d.Rows:N0} row(s) — far fewer than the {state.RowCount:N0} already in PVT{d.Year % 100:00}.TXT. Importing it replaces the WHOLE year's file with just this one, losing the rest. Type {d.Year} to confirm you mean to do this.";
                }
                else
                {
                    detail = d.Kind == "private"
                        ? $"Replaces the current PVT{d.Year % 100:00}.TXT ({state.RowCount:N0} rows) — make sure this is the full, up-to-date file for the year, not just an increment."
                        : $"Replaces an already-imported file at the same sale/broker ({state.RowCount:N0} rows).";
                }
            }

            var stagingId = Guid.NewGuid().ToString("N");
            staging.AddFile(batchId, new MslStagedFile(
                stagingId, d.FileName, d.SourceZip, d.Kind, d.Broker, d.Year, d.SaleNo,
                d.TempPath, d.TargetRelPath, d.Rows, null, willReplace, detail, requiresConfirmation, confirmToken));
            staged.Add(new MslStagedFileDto(
                stagingId, d.FileName, d.SourceZip, d.Kind, d.Broker, d.Year, d.SaleNo, d.Rows, null,
                willReplace, detail, requiresConfirmation, confirmToken));
        }

        return Ok(new MslStageBatchResultDto(batchId, staged, DateTime.UtcNow.AddHours(2)));
    }

    /// <summary>Step 2: the admin's chosen subset of a staged batch (see
    /// <see cref="StageBatch"/>) — those files move into the real archive at the target
    /// path already computed while staging, one scan covers all of them, and the batch's
    /// scratch directory is cleaned up regardless of what was kept (kept files were moved
    /// out of it; anything excluded or rejected just gets deleted with it).</summary>
    [HttpPost("upload-batch/commit")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<MslBatchUploadResultDto>> CommitBatch([FromBody] MslCommitBatchRequestDto req, CancellationToken ct)
    {
        var root = importer.DataPath;
        if (root is null) return BadRequest("MSL data folder not found — set Msl:DataPath or create data/msl.");
        var files = staging.GetFiles(req.BatchId);
        if (files is null) return BadRequest("This upload batch has expired or wasn't found — please upload again.");

        var keep = new HashSet<string>(req.Keep);
        var results = new List<MslBatchFileResultDto>();
        foreach (var f in files.Where(f => keep.Contains(f.StagingId) && f.Error is null && f.TargetRelPath is not null))
        {
            var targetPath = Path.Combine(root, f.TargetRelPath!.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            System.IO.File.Move(f.TempPath, targetPath, overwrite: true);
            results.Add(new MslBatchFileResultDto(f.FileName, f.SourceZip, f.Kind, f.Broker, f.Year, f.SaleNo, 0, null));
        }

        staging.Discard(req.BatchId);

        if (results.Count == 0)
            return Ok(new MslBatchUploadResultDto(results, new MslScanSummary(0, 0, 0, 0, [], TimeSpan.Zero)));

        var scan = await importer.ScanAsync(force: false, ct);

        // Backfill each file's actual row count from the tracking state the scan just
        // wrote, and fold in an import-time error if that specific file failed (e.g. a
        // truly malformed file that parsed cleanly enough to detect but broke on import).
        var final = new List<MslBatchFileResultDto>();
        foreach (var r in results)
        {
            var rel = r.Kind == "private"
                ? $"private-sales/PVT{r.Year!.Value % 100:00}.TXT"
                : $"auction/{r.Year}/sale-{r.SaleNo:00}/{r.FileName}";
            var state = await db.MslFiles.Find(f => f.RelativePath == rel).FirstOrDefaultAsync(ct);
            final.Add(r with { Rows = state?.RowCount ?? 0, Error = state?.Error });
        }

        await audit.LogAsync(User, "msl.batchUploaded", "MslFile", "auction+private/*",
            $"{final.Count(r => r.Error is null)} of {final.Count} file(s) confirmed by admin, {scan.RowsImported:N0} row(s)", ct);
        return Ok(new MslBatchUploadResultDto(final, scan));
    }

    /// <summary>Drops a staged batch the admin decided not to import at all — e.g. closing
    /// the review list without confirming. Abandoned batches also expire on their own after
    /// 2 hours (see MslUploadStagingService), so this is a courtesy, not the only cleanup
    /// path.</summary>
    [HttpPost("upload-batch/discard")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public IActionResult DiscardBatch([FromQuery] string batchId)
    {
        staging.Discard(batchId);
        return NoContent();
    }

    private static readonly Regex AuctionPathRe = new(@"^auction/(\d{4})/sale-(\d+)/", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex PrivatePathRe = new(@"^private-sales/PVT(\d{2})\.TXT$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex TeaBoardPathRe = new(@"^tea-board/national-averages-(\d{4})-(\d{2})\.pdf$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static MslTrackedFileDto ToTrackedDto(MslFileState f)
    {
        var auctionMatch = AuctionPathRe.Match(f.RelativePath);
        if (auctionMatch.Success)
            return new MslTrackedFileDto(f.RelativePath, "auction", int.Parse(auctionMatch.Groups[1].Value),
                int.Parse(auctionMatch.Groups[2].Value), f.Length, f.LastWriteUtc, f.ImportedAt, f.RowCount, f.Error);

        var pvtMatch = PrivatePathRe.Match(f.RelativePath);
        if (pvtMatch.Success)
            return new MslTrackedFileDto(f.RelativePath, "private", 2000 + int.Parse(pvtMatch.Groups[1].Value),
                null, f.Length, f.LastWriteUtc, f.ImportedAt, f.RowCount, f.Error);

        var tbMatch = TeaBoardPathRe.Match(f.RelativePath);
        if (tbMatch.Success)
            return new MslTrackedFileDto(f.RelativePath, "teaboard", int.Parse(tbMatch.Groups[1].Value),
                int.Parse(tbMatch.Groups[2].Value), f.Length, f.LastWriteUtc, f.ImportedAt, f.RowCount, f.Error);

        return new MslTrackedFileDto(f.RelativePath, "other", null, null, f.Length, f.LastWriteUtc, f.ImportedAt, f.RowCount, f.Error);
    }

    /// <summary>Every file the importer currently tracks — the Admin Panel's "browse
    /// archive files" list, for reviewing or removing something imported previously, not
    /// just at upload time.</summary>
    [HttpGet("files")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<List<MslTrackedFileDto>>> ListFiles(CancellationToken ct)
    {
        var files = await db.MslFiles.Find(FilterDefinition<MslFileState>.Empty).ToListAsync(ct);
        return files.Select(ToTrackedDto).OrderByDescending(f => f.RelativePath).ToList();
    }

    /// <summary>Removes one file from the archive — deletes it from disk, then rescans; the
    /// scan itself is what drops that file's already-imported rows from MongoDB (see
    /// MslImportService.ScanAsync's "files that vanished from the folder" pass), so this
    /// endpoint only ever needs to touch the filesystem, never Mongo directly.</summary>
    [HttpDelete("files")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageDataFiles)]
    public async Task<ActionResult<MslScanSummary>> DeleteFile([FromQuery] string path, CancellationToken ct)
    {
        var root = importer.DataPath;
        if (root is null) return BadRequest("MSL data folder not found — set Msl:DataPath or create data/msl.");
        if (string.IsNullOrWhiteSpace(path)) return BadRequest("path is required.");

        var rootFull = Path.GetFullPath(root);
        var full = Path.GetFullPath(Path.Combine(rootFull, path));
        if (!full.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            return BadRequest("Invalid path.");
        if (!System.IO.File.Exists(full)) return NotFound("File not found.");

        var priorRows = (await db.MslFiles.Find(f => f.RelativePath == path).FirstOrDefaultAsync(ct))?.RowCount ?? 0;
        System.IO.File.Delete(full);
        var scan = await importer.ScanAsync(force: false, ct);

        await audit.LogAsync(User, "msl.fileDeleted", "MslFile", path, $"removed from archive, {priorRows:N0} row(s) dropped", ct);
        return Ok(scan);
    }

    [HttpGet("search")]
    public async Task<ActionResult<MslSearchResultDto>> Search(
        [FromQuery] string? q, [FromQuery] string? broker, [FromQuery] string? grade,
        [FromQuery] string? elevation, [FromQuery] string? buyer, [FromQuery] string? factory,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, [FromQuery] int? saleNo,
        [FromQuery] bool? sold, [FromQuery] bool? isPrivate,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);
        page = Math.Max(page, 1);
        var filter = BuildFilter(q, broker, grade, elevation, buyer, factory, yearFrom, yearTo, saleNo, sold, isPrivate);

        var find = db.AuctionLots.Find(filter)
            .SortByDescending(l => l.SaleDate).ThenBy(l => l.Broker).ThenBy(l => l.LotNo);
        var items = await find.Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var aggregate = await Cached(
            $"searchagg:{q}|{broker}|{grade}|{elevation}|{buyer}|{factory}|{yearFrom}|{yearTo}|{saleNo}|{sold}|{isPrivate}",
            () => AggregateOf(filter, ct));

        return new MslSearchResultDto(items.Select(ToDto).ToList(), aggregate.Lots, aggregate);
    }

    /// <summary>Grouped statistics over any filtered slice — the "averages, quantities or
    /// whatever" view. groupBy: year | sale | grade | elevation | mark | estate | buyer |
    /// broker | factory.</summary>
    [HttpGet("aggregate")]
    public async Task<ActionResult<List<MslAggregateRowDto>>> Aggregate(
        [FromQuery] string groupBy,
        [FromQuery] string? q, [FromQuery] string? broker, [FromQuery] string? grade,
        [FromQuery] string? elevation, [FromQuery] string? buyer, [FromQuery] string? factory,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, [FromQuery] int? saleNo,
        [FromQuery] bool? sold, [FromQuery] bool? isPrivate,
        [FromQuery] int limit = 100,
        CancellationToken ct = default)
    {
        var keyField = groupBy?.ToLowerInvariant() switch
        {
            "year" => "$y",
            "sale" => new BsonDocument("$concat", new BsonArray
                { new BsonDocument("$toString", "$y"), "-", new BsonDocument("$toString", "$s") }) as BsonValue,
            "grade" => "$g",
            "elevation" => "$el",
            "mark" => "$m",
            "estate" => "$e",
            "buyer" => new BsonDocument("$ifNull", new BsonArray { "$bn", "$bc" }) as BsonValue,
            "broker" => "$b",
            "factory" => "$f",
            _ => null,
        };
        if (keyField is null) return BadRequest("groupBy must be one of: year, sale, grade, elevation, mark, estate, buyer, broker, factory");
        limit = Math.Clamp(limit, 1, 1000);

        var filter = BuildFilter(q, broker, grade, elevation, buyer, factory, yearFrom, yearTo, saleNo, sold, isPrivate);
        var match = filter.Render(new RenderArgs<AuctionLot>(
            db.AuctionLots.DocumentSerializer, db.AuctionLots.Settings.SerializerRegistry));

        var pipeline = new[]
        {
            new BsonDocument("$match", match),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = keyField,
                ["lots"] = new BsonDocument("$sum", 1),
                ["soldLots"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 1, 0 })),
                ["totalQty"] = new BsonDocument("$sum", "$q"),
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["value"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { "$so", new BsonDocument("$multiply", new BsonArray { "$q", "$p" }), 0 })),
                ["minP"] = new BsonDocument("$min", new BsonDocument("$cond", new BsonArray
                    { "$so", "$p", BsonNull.Value })),
                ["maxP"] = new BsonDocument("$max", "$p"),
            }),
            new BsonDocument("$sort", new BsonDocument("totalQty", -1)),
            new BsonDocument("$limit", limit),
        };

        var isElevation = groupBy!.Equals("elevation", StringComparison.OrdinalIgnoreCase);
        var docs = await Cached(
            $"group:{groupBy}|{limit}|{q}|{broker}|{grade}|{elevation}|{buyer}|{factory}|{yearFrom}|{yearTo}|{saleNo}|{sold}|{isPrivate}",
            () => db.AuctionLots.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct));
        return docs.Select(d =>
        {
            var soldQty = d["soldQty"].ToDecimal();
            var value = d["value"].ToDecimal();
            var key = d["_id"].IsBsonNull ? "(unknown)" : d["_id"].ToString() ?? "(unknown)";
            if (isElevation && MslBrokers.ElevationNames.TryGetValue(key, out var elName)) key = elName;
            return new MslAggregateRowDto(
                key,
                d["lots"].ToInt64(),
                d["soldLots"].ToInt64(),
                Math.Round(d["totalQty"].ToDecimal(), 2),
                Math.Round(soldQty, 2),
                soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
                d["minP"].IsBsonNull ? null : d["minP"].ToDecimal(),
                d["maxP"].ToDecimal() is var mx and > 0 ? mx : null);
        }).ToList();
    }

    /// <summary>Joins one sale's MSL rows to the weekly sale Excel catalogue on
    /// (broker, lot) and reports every disagreement — price corrections, lots settled
    /// after the auction, and rows present on only one side.</summary>
    [HttpGet("sales/{year:int}/{saleNo:int}/comparison")]
    public async Task<ActionResult<SaleComparisonDto>> Comparison(int year, int saleNo, CancellationToken ct)
    {
        var catalogue = catalogues.ListCatalogues()
            .FirstOrDefault(c => Regex.IsMatch(c.SourceName, $@"^Sale {saleNo} - {year}$"));
        if (catalogue is null) return NotFound($"No imported sale Excel found for sale {saleNo} {year}.");
        var excelLots = catalogues.GetLots(catalogue.Id);
        if (excelLots is null) return NotFound("Catalogue lots unavailable.");

        var mslLots = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo && !l.IsPrivate)
            .ToListAsync(ct);
        var byKey = mslLots
            .Where(l => l.Broker is not null)
            .ToDictionary(l => (l.Broker!, l.LotNo), l => l);

        int joined = 0, agree = 0;
        var diffs = new List<SaleComparisonDiffDto>();
        var seen = new HashSet<(string, string)>();
        foreach (var ex in excelLots)
        {
            if (ex.Broker is null || ex.LotNumber is null) continue;
            if (!MslBrokers.ExcelCodeToMslCode.TryGetValue(ex.Broker.Trim(), out var mslBroker)) continue;
            var key = (mslBroker, ex.LotNumber.Trim().TrimStart('0'));
            if (!byKey.TryGetValue(key, out var msl))
            {
                diffs.Add(new SaleComparisonDiffDto(mslBroker, key.Item2, ex.SellingMark ?? "", ex.Grade ?? "",
                    ex.PurchasedPrice, 0, "MissingInMsl"));
                continue;
            }
            seen.Add(key);
            joined++;
            var excelPrice = ex.PurchasedPrice;
            if (excelPrice is null && msl.PriceRs == 0) { agree++; continue; }
            if (excelPrice is not null && Math.Abs(excelPrice.Value - msl.PriceRs) < 0.01m) { agree++; continue; }
            var kind = excelPrice is null ? "SoldAfterAuction"
                : msl.PriceRs == 0 ? "NotSettledInMsl"
                : "PriceCorrected";
            diffs.Add(new SaleComparisonDiffDto(mslBroker, key.Item2, msl.SellingMark, msl.Grade,
                excelPrice, msl.PriceRs, kind));
        }
        foreach (var msl in mslLots.Where(l => l.Broker is not null && !seen.Contains((l.Broker!, l.LotNo))))
            diffs.Add(new SaleComparisonDiffDto(msl.Broker!, msl.LotNo, msl.SellingMark, msl.Grade,
                null, msl.PriceRs, "MissingInExcel"));

        return new SaleComparisonDto(year, saleNo, excelLots.Count, mslLots.Count, joined, agree,
            diffs.Take(500).ToList());
    }

    [HttpGet("teaboard")]
    public async Task<ActionResult<List<TeaBoardRowDto>>> TeaBoard(
        [FromQuery] string? section, [FromQuery] string? elevation,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, CancellationToken ct = default)
    {
        var fb = Builders<TeaBoardAverage>.Filter;
        var filters = new List<FilterDefinition<TeaBoardAverage>>();
        if (!string.IsNullOrWhiteSpace(section)) filters.Add(fb.Eq(t => t.Section, section.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(elevation)) filters.Add(fb.Eq(t => t.Elevation, elevation.ToUpperInvariant()));
        if (yearFrom is not null) filters.Add(fb.Gte(t => t.Year, yearFrom.Value));
        if (yearTo is not null) filters.Add(fb.Lte(t => t.Year, yearTo.Value));
        var rows = await db.TeaBoardAverages
            .Find(filters.Count > 0 ? fb.And(filters) : FilterDefinition<TeaBoardAverage>.Empty)
            .SortBy(t => t.Year).ThenBy(t => t.Month).ThenBy(t => t.Section).ThenBy(t => t.Elevation)
            .ToListAsync(ct);
        return rows.Select(t => new TeaBoardRowDto(
            t.Year, t.Month, t.Section, t.Elevation, t.MonthQtyKg, t.MonthAvgRs, t.TodateQtyKg, t.TodateAvgRs)).ToList();
    }

    private static FilterDefinition<AuctionLot> BuildFilter(
        string? q, string? broker, string? grade, string? elevation, string? buyer,
        string? factory, int? yearFrom, int? yearTo, int? saleNo, bool? sold, bool? isPrivate)
    {
        var fb = Builders<AuctionLot>.Filter;
        var filters = new List<FilterDefinition<AuctionLot>>();
        if (!string.IsNullOrWhiteSpace(q))
        {
            // Anchored, case-sensitive, uppercased: every name field in the MSL data is
            // uppercase, and only anchored case-sensitive regexes can walk the indexes —
            // this is what keeps a 7M-row search at milliseconds instead of a full scan.
            var re = new BsonRegularExpression("^" + Regex.Escape(q.Trim().ToUpperInvariant()));
            filters.Add(fb.Or(
                fb.Regex(l => l.SellingMark, re),
                fb.Regex(l => l.EstateName, re),
                fb.Regex(l => l.BuyerName, re),
                fb.Regex(l => l.FactoryCode, re),
                fb.Regex(l => l.MslCode, re)));
        }
        if (!string.IsNullOrWhiteSpace(broker)) filters.Add(fb.Eq(l => l.Broker, broker.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(grade)) filters.Add(fb.Eq(l => l.Grade, grade.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(elevation))
        {
            // Accept either the 2-digit code or the name ("WESTERN HIGH").
            var code = MslBrokers.ElevationNames.FirstOrDefault(kv =>
                kv.Value.Equals(elevation.Trim(), StringComparison.OrdinalIgnoreCase)).Key ?? elevation.Trim();
            filters.Add(fb.Eq(l => l.ElevationCode, code));
        }
        if (!string.IsNullOrWhiteSpace(buyer))
        {
            var re = new BsonRegularExpression(Regex.Escape(buyer.Trim()), "i");
            filters.Add(fb.Or(fb.Regex(l => l.BuyerCode, re), fb.Regex(l => l.BuyerName, re)));
        }
        if (!string.IsNullOrWhiteSpace(factory))
            filters.Add(fb.Eq(l => l.FactoryCode, factory.Replace(" ", "").ToUpperInvariant()));
        if (yearFrom is not null) filters.Add(fb.Gte(l => l.SaleYear, yearFrom.Value));
        if (yearTo is not null) filters.Add(fb.Lte(l => l.SaleYear, yearTo.Value));
        if (saleNo is not null) filters.Add(fb.Eq(l => l.SaleNo, saleNo.Value));
        if (sold is not null) filters.Add(fb.Eq(l => l.Sold, sold.Value));
        if (isPrivate is not null) filters.Add(fb.Eq(l => l.IsPrivate, isPrivate.Value));
        return filters.Count > 0 ? fb.And(filters) : FilterDefinition<AuctionLot>.Empty;
    }

    private async Task<MslSearchAggregateDto> AggregateOf(FilterDefinition<AuctionLot> filter, CancellationToken ct)
    {
        var match = filter.Render(new RenderArgs<AuctionLot>(
            db.AuctionLots.DocumentSerializer, db.AuctionLots.Settings.SerializerRegistry));
        var pipeline = new[]
        {
            new BsonDocument("$match", match),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = BsonNull.Value,
                ["lots"] = new BsonDocument("$sum", 1),
                ["soldLots"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 1, 0 })),
                ["totalQty"] = new BsonDocument("$sum", "$q"),
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["value"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { "$so", new BsonDocument("$multiply", new BsonArray { "$q", "$p" }), 0 })),
                ["minP"] = new BsonDocument("$min", new BsonDocument("$cond", new BsonArray
                    { "$so", "$p", BsonNull.Value })),
                ["maxP"] = new BsonDocument("$max", "$p"),
            }),
        };
        var doc = await db.AuctionLots.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).FirstOrDefaultAsync(ct);
        if (doc is null) return new MslSearchAggregateDto(0, 0, 0, 0, null, null, null);
        var soldQty = doc["soldQty"].ToDecimal();
        var value = doc["value"].ToDecimal();
        return new MslSearchAggregateDto(
            doc["lots"].ToInt64(),
            doc["soldLots"].ToInt64(),
            Math.Round(doc["totalQty"].ToDecimal(), 2),
            Math.Round(soldQty, 2),
            soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
            doc["minP"].IsBsonNull ? null : doc["minP"].ToDecimal(),
            doc["maxP"].ToDecimal() is var mx and > 0 ? mx : null);
    }

    private static AuctionLotDto ToDto(AuctionLot l) => new(
        l.SaleYear, l.SaleNo, l.SaleDate, l.Broker,
        l.Broker is not null && MslBrokers.CodeToName.TryGetValue(l.Broker, out var name) ? name : null,
        l.IsPrivate, l.LotNo, l.Invoice, l.FactoryCode, l.SellingMark, l.Grade,
        l.QuantityKg, l.PriceRs, l.Sold, l.BuyerCode, l.BuyerName, l.EstateName, l.MslCode,
        l.ElevationCode,
        l.ElevationCode is not null && MslBrokers.ElevationNames.TryGetValue(l.ElevationCode, out var el) ? el : null,
        l.RefuseTea);
}
