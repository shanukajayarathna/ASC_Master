using System.Collections.Concurrent;

namespace Asc.Api.Modules.Msl;

/// <summary>One file sitting in a staging batch, waiting for the admin to confirm or drop
/// it — everything the upload-batch review list needs, plus the extracted bytes' temp
/// location and the real archive path it would land on if kept.</summary>
public record MslStagedFile(
    string StagingId, string FileName, string? SourceZip, string? Kind,
    string? Broker, int? Year, int? SaleNo, string TempPath, string? TargetRelPath,
    int Rows, string? Error, bool WillReplace, string? ReplaceDetail,
    bool RequiresConfirmation, string? ConfirmToken);

/// <summary>Holds uploaded MSL files in a scratch folder between "stage" (extract + detect —
/// nothing touches data/msl or MongoDB yet) and "commit" (the admin picks which detected
/// files to keep in the Admin Panel's review list; only those move into the real archive and
/// get scanned). A plain in-memory store is enough: batches are short-lived (one review
/// session) and are swept by age so an admin who uploads and never confirms doesn't leak
/// staged files on disk forever. Registered as a singleton so the dictionary survives across
/// the (transient, per-request) MslController instances that stage/commit/discard it.</summary>
public class MslUploadStagingService(ILogger<MslUploadStagingService> logger)
{
    private static readonly TimeSpan BatchTtl = TimeSpan.FromHours(2);

    private record Batch(List<MslStagedFile> Files, DateTime CreatedUtc);

    private readonly ConcurrentDictionary<string, Batch> _batches = new();
    private string? _root;

    private string RootDir => _root ??= Path.Combine(Path.GetTempPath(), "asc-msl-staging");

    private string DirFor(string batchId) => Path.Combine(RootDir, batchId);

    /// <summary>Starts a new batch (sweeping expired ones first) and returns its id plus the
    /// scratch directory to extract/copy candidate files into.</summary>
    public (string BatchId, string Dir) BeginBatch()
    {
        Sweep();
        var id = Guid.NewGuid().ToString("N");
        var dir = DirFor(id);
        Directory.CreateDirectory(dir);
        _batches[id] = new Batch([], DateTime.UtcNow);
        return (id, dir);
    }

    public void AddFile(string batchId, MslStagedFile file)
    {
        if (_batches.TryGetValue(batchId, out var b)) b.Files.Add(file);
    }

    public DateTime? CreatedAt(string batchId) => _batches.TryGetValue(batchId, out var b) ? b.CreatedUtc : null;

    public IReadOnlyList<MslStagedFile>? GetFiles(string batchId) =>
        _batches.TryGetValue(batchId, out var b) ? b.Files : null;

    /// <summary>Drops a batch's bookkeeping and deletes whatever's left in its scratch
    /// directory (commit already moved out the files it kept, so this is just the leftovers
    /// — excluded files and anything that failed to parse).</summary>
    public void Discard(string batchId)
    {
        _batches.TryRemove(batchId, out _);
        var dir = DirFor(batchId);
        if (Directory.Exists(dir))
        {
            try { Directory.Delete(dir, recursive: true); }
            catch (IOException ex) { logger.LogWarning(ex, "Couldn't clean up MSL staging dir {Dir}", dir); }
        }
    }

    private void Sweep()
    {
        var cutoff = DateTime.UtcNow - BatchTtl;
        foreach (var id in _batches.Where(kv => kv.Value.CreatedUtc < cutoff).Select(kv => kv.Key).ToList())
            Discard(id);
    }
}
