namespace Asc.Api.Modules.AdminAssets;

/// <summary>Current state of one asset slot, for the admin panel's file manager list.</summary>
public sealed record AdminAssetStatus(
    string Id, string Group, string Label, string Description, string FileName,
    bool HasOverride, long? SizeBytes, DateTime? UploadedAtUtc, string? UploadedBy);

/// <summary>
/// The admin-asset seam — same shape as IDocumentStore/ILotMediaStore: local disk now,
/// behind an interface a database/blob store can take over later without touching the
/// controller.
/// </summary>
public interface IAdminAssetStore
{
    IReadOnlyList<AdminAssetStatus> ListStatus();

    /// <summary>Slot ids that currently have an admin-uploaded override — cheap enough to
    /// call before generating a batch of reports, so callers only fetch the slots that
    /// actually differ from their bundled default instead of probing every one.</summary>
    IReadOnlySet<string> OverrideIds();

    (string Path, string ContentType)? Get(string slotId);
    Task<AdminAssetStatus?> SaveAsync(string slotId, Stream data, string uploadedByEmail, CancellationToken ct = default);
    bool Revert(string slotId);
}

/// <summary>Stores each override as data/{slot.RelativePath} — the exact same relative
/// layout as the bundled defaults it replaces (data/templates/fact/fact-uh.xlsx, etc.),
/// plus a sidecar `.uploadedby` text file recording who last replaced it.</summary>
public class LocalAdminAssetStore(IWebHostEnvironment env) : IAdminAssetStore
{
    private string DataDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data"));
    private string PathFor(AdminAssetSlot slot) => Path.Combine(DataDir, slot.RelativePath.Replace('/', Path.DirectorySeparatorChar));
    private string UploaderPathFor(AdminAssetSlot slot) => PathFor(slot) + ".uploadedby";

    public IReadOnlyList<AdminAssetStatus> ListStatus() =>
        AdminAssetCatalog.Slots.Select(ToStatus).ToList();

    public IReadOnlySet<string> OverrideIds() =>
        AdminAssetCatalog.Slots.Where(s => File.Exists(PathFor(s))).Select(s => s.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);

    private AdminAssetStatus ToStatus(AdminAssetSlot slot)
    {
        var path = PathFor(slot);
        if (!File.Exists(path))
            return new AdminAssetStatus(slot.Id, slot.Group, slot.Label, slot.Description, slot.FileName, false, null, null, null);

        var info = new FileInfo(path);
        string? uploadedBy = null;
        try
        {
            var uploaderPath = UploaderPathFor(slot);
            if (File.Exists(uploaderPath)) uploadedBy = File.ReadAllText(uploaderPath).Trim();
        }
        catch
        {
            // Uploader attribution is a nicety — never fail a listing over it.
        }
        return new AdminAssetStatus(slot.Id, slot.Group, slot.Label, slot.Description, slot.FileName, true, info.Length, info.LastWriteTimeUtc, uploadedBy);
    }

    public (string Path, string ContentType)? Get(string slotId)
    {
        var slot = AdminAssetCatalog.Find(slotId);
        if (slot is null) return null;
        var path = PathFor(slot);
        return File.Exists(path) ? (path, slot.ContentType) : null;
    }

    public async Task<AdminAssetStatus?> SaveAsync(string slotId, Stream data, string uploadedByEmail, CancellationToken ct = default)
    {
        var slot = AdminAssetCatalog.Find(slotId);
        if (slot is null) return null;

        var path = PathFor(slot);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        await using (var fs = File.Create(tmp))
        {
            await data.CopyToAsync(fs, ct);
        }
        File.Move(tmp, path, overwrite: true);
        try { await File.WriteAllTextAsync(UploaderPathFor(slot), uploadedByEmail, ct); }
        catch { /* attribution is a nicety */ }

        return ToStatus(slot);
    }

    public bool Revert(string slotId)
    {
        var slot = AdminAssetCatalog.Find(slotId);
        if (slot is null) return false;

        var path = PathFor(slot);
        var existed = File.Exists(path);
        if (existed) File.Delete(path);
        var uploaderPath = UploaderPathFor(slot);
        if (File.Exists(uploaderPath)) File.Delete(uploaderPath);
        return existed;
    }
}
