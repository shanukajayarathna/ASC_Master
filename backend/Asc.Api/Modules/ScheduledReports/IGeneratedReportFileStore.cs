namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// Where an automated job's actual output bytes live, keyed by the SavedReport.StoredFileId
/// that points to it. Same seam shape as ILotMediaStore/IDocumentStore: local disk now, a
/// database/blob store can take over later without touching a caller.
/// </summary>
public interface IGeneratedReportFileStore
{
    Task<Guid> SaveAsync(Stream data, string fileName, string contentType, CancellationToken ct = default);
    (string Path, string FileName, string ContentType)? Get(Guid fileId);
}

/// <summary>Stores each generated report bundle as data/generated-reports/{id}/{fileName} —
/// one directory per stored file, named after the id rather than the report's own Guid so a
/// future report type that stores more than one file per SavedReport isn't blocked.</summary>
public class LocalGeneratedReportFileStore(IWebHostEnvironment env) : IGeneratedReportFileStore
{
    public string RootDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "generated-reports"));
    private string FileDir(Guid fileId) => Path.Combine(RootDir, fileId.ToString("D"));

    // FileName round-trips into the store as-is (it's a filename this same backend generated,
    // e.g. "weekly_reports_sale34_20260824.zip" — not user input), but strip any path
    // separators regardless so it can never escape FileDir.
    private static string SanitizeFileName(string fileName) =>
        string.Join("_", fileName.Split(Path.GetInvalidFileNameChars().Concat(['/', '\\']).ToArray()));

    public async Task<Guid> SaveAsync(Stream data, string fileName, string contentType, CancellationToken ct = default)
    {
        var id = Guid.NewGuid();
        var dir = FileDir(id);
        Directory.CreateDirectory(dir);
        var safeName = SanitizeFileName(fileName);
        var path = Path.Combine(dir, safeName);
        var tmp = path + ".tmp";
        await using (var fs = File.Create(tmp))
        {
            await data.CopyToAsync(fs, ct);
        }
        File.Move(tmp, path, overwrite: true);
        await File.WriteAllTextAsync(Path.Combine(dir, "content-type.txt"), contentType, ct);
        return id;
    }

    public (string Path, string FileName, string ContentType)? Get(Guid fileId)
    {
        var dir = FileDir(fileId);
        if (!Directory.Exists(dir)) return null;
        var file = Directory.GetFiles(dir).FirstOrDefault(f => !f.EndsWith(".tmp") && !f.EndsWith("content-type.txt"));
        if (file is null) return null;
        var contentTypePath = Path.Combine(dir, "content-type.txt");
        var contentType = File.Exists(contentTypePath) ? File.ReadAllText(contentTypePath).Trim() : "application/octet-stream";
        return (file, Path.GetFileName(file), contentType);
    }
}
