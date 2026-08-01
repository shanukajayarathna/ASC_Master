namespace Asc.Api.Modules.Documents;

/// <summary>
/// The document seam — same shape as <c>ILotMediaStore</c> (see
/// backend/Asc.Api/Services/LotMediaStore.cs): local disk now, behind an interface a
/// database/blob store can take over later without touching the controller.
/// </summary>
public interface IDocumentStore
{
    Task SaveAsync(Guid documentId, Stream data, string extension, CancellationToken ct = default);
    (string Path, string Extension)? Get(Guid documentId);
    bool Delete(Guid documentId);
}

/// <summary>Stores the original uploaded file as data/documents/{id}/original.{ext} — one file
/// per document, no multi-slot logic needed (unlike lot media's photo/voice-per-field).</summary>
public class LocalDocumentStore(IWebHostEnvironment env) : IDocumentStore
{
    public string DocumentsDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "documents"));
    private string DocDir(Guid documentId) => Path.Combine(DocumentsDir, documentId.ToString("D"));

    public async Task SaveAsync(Guid documentId, Stream data, string extension, CancellationToken ct = default)
    {
        var dir = DocDir(documentId);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"original.{extension}");
        var tmp = path + ".tmp";
        await using (var fs = File.Create(tmp))
        {
            await data.CopyToAsync(fs, ct);
        }
        File.Move(tmp, path, overwrite: true);
    }

    public (string Path, string Extension)? Get(Guid documentId)
    {
        var dir = DocDir(documentId);
        if (!Directory.Exists(dir)) return null;
        var file = Directory.GetFiles(dir, "original.*").FirstOrDefault(f => !f.EndsWith(".tmp"));
        return file is null ? null : (file, Path.GetExtension(file).TrimStart('.'));
    }

    public bool Delete(Guid documentId)
    {
        var dir = DocDir(documentId);
        if (!Directory.Exists(dir)) return false;
        try
        {
            Directory.Delete(dir, recursive: true);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
