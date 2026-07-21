using System.Text.RegularExpressions;

namespace Asc.Api.Services;

/// <summary>What media a lot currently has: a photo, and which remark fields carry a voice note.</summary>
public record LotMediaManifest(bool Photo, string[] Voice);

/// <summary>
/// The lot-media seam. Photos and per-field voice notes for a lot go through this interface,
/// exactly like <see cref="ICatalogueSource"/> is the seam for catalogue data — so the local
/// disk-backed store below can later be swapped for a database/blob-store (Mongo GridFS,
/// Azure Blob, S3, …) without touching the controller. Media is keyed by lot id only; a lot
/// id already encodes its sale, so nothing else is needed to find it.
/// </summary>
public interface ILotMediaStore
{
    Task SavePhotoAsync(Guid lotId, Stream data, string contentType, CancellationToken ct = default);
    (string Path, string ContentType)? GetPhoto(Guid lotId);
    bool DeletePhoto(Guid lotId);

    Task SaveVoiceAsync(Guid lotId, string field, Stream data, string contentType, CancellationToken ct = default);
    (string Path, string ContentType)? GetVoice(Guid lotId, string field);
    bool DeleteVoice(Guid lotId, string field);

    /// <summary>Cheap existence check — what the focus view asks for once per lot.</summary>
    LotMediaManifest GetManifest(Guid lotId);
}

/// <summary>
/// Stores lot photos and voice notes as plain files under data/media/{lotId}. One photo per
/// lot (photo.*) and one voice note per remark field (voice-{field}.*); the file extension
/// carries the format so any tablet's recorder (webm on Android/Chrome, mp4 on iOS/Safari)
/// round-trips with the right content type. This is the "store locally for now" step — the
/// <see cref="ILotMediaStore"/> seam is the arrangement that lets a database/blob store take
/// over later without any caller change.
/// </summary>
public class LocalLotMediaStore(IWebHostEnvironment env) : ILotMediaStore
{
    // Field names come straight into a filename, so they're kept to plain letters — no dots,
    // slashes or dashes that could escape the lot's folder or collide with the "voice-" prefix.
    private static readonly Regex FieldPattern = new("^[A-Za-z]{2,40}$", RegexOptions.Compiled);

    public static bool IsValidField(string field) => FieldPattern.IsMatch(field);

    private static readonly Dictionary<string, string> ExtByType = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "jpg", ["image/jpg"] = "jpg", ["image/png"] = "png", ["image/webp"] = "webp",
        ["audio/webm"] = "webm", ["audio/ogg"] = "ogg", ["audio/mp4"] = "mp4", ["audio/x-m4a"] = "m4a",
        ["audio/mpeg"] = "mp3", ["audio/wav"] = "wav", ["audio/x-wav"] = "wav", ["audio/wave"] = "wav",
        ["audio/aac"] = "aac",
    };

    private static readonly Dictionary<string, string> TypeByExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ["jpg"] = "image/jpeg", ["jpeg"] = "image/jpeg", ["png"] = "image/png", ["webp"] = "image/webp",
        ["webm"] = "audio/webm", ["ogg"] = "audio/ogg", ["mp4"] = "audio/mp4", ["m4a"] = "audio/mp4",
        ["mp3"] = "audio/mpeg", ["wav"] = "audio/wav", ["aac"] = "audio/aac",
    };

    public string MediaDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "media"));
    private string LotDir(Guid lotId) => Path.Combine(MediaDir, lotId.ToString("D"));

    // ---- photo ----------------------------------------------------------------------

    public Task SavePhotoAsync(Guid lotId, Stream data, string contentType, CancellationToken ct = default) =>
        SaveAsync(lotId, "photo", data, contentType, defaultExt: "jpg", ct);

    public (string Path, string ContentType)? GetPhoto(Guid lotId) => Find(lotId, "photo.*");

    public bool DeletePhoto(Guid lotId) => DeleteMatching(lotId, "photo.*");

    // ---- voice ----------------------------------------------------------------------

    public Task SaveVoiceAsync(Guid lotId, string field, Stream data, string contentType, CancellationToken ct = default)
    {
        Require(field);
        return SaveAsync(lotId, $"voice-{field}", data, contentType, defaultExt: "webm", ct);
    }

    public (string Path, string ContentType)? GetVoice(Guid lotId, string field)
    {
        Require(field);
        return Find(lotId, $"voice-{field}.*");
    }

    public bool DeleteVoice(Guid lotId, string field)
    {
        Require(field);
        return DeleteMatching(lotId, $"voice-{field}.*");
    }

    // ---- manifest -------------------------------------------------------------------

    public LotMediaManifest GetManifest(Guid lotId)
    {
        var dir = LotDir(lotId);
        if (!Directory.Exists(dir)) return new LotMediaManifest(false, Array.Empty<string>());

        var names = Directory.GetFiles(dir).Select(Path.GetFileName).Where(n => n is not null && !n.EndsWith(".tmp")).ToList();
        var photo = names.Any(n => n!.StartsWith("photo.", StringComparison.OrdinalIgnoreCase));
        var voice = names
            .Where(n => n!.StartsWith("voice-", StringComparison.OrdinalIgnoreCase))
            .Select(n => StripPrefixAndExt(n!, "voice-"))
            .Where(f => f.Length > 0)
            .Distinct()
            .ToArray();
        return new LotMediaManifest(photo, voice);
    }

    // ---- helpers --------------------------------------------------------------------

    private static void Require(string field)
    {
        if (!IsValidField(field)) throw new ArgumentException($"Invalid media field '{field}'.", nameof(field));
    }

    private async Task SaveAsync(Guid lotId, string baseName, Stream data, string contentType, string defaultExt, CancellationToken ct)
    {
        var dir = LotDir(lotId);
        Directory.CreateDirectory(dir);
        // One file per slot — clear any prior copy (possibly a different extension) first.
        foreach (var f in Directory.GetFiles(dir, $"{baseName}.*")) TryDelete(f);

        var ext = ExtByType.GetValueOrDefault(contentType ?? "", defaultExt);
        var path = Path.Combine(dir, $"{baseName}.{ext}");
        var tmp = path + ".tmp";
        await using (var fs = File.Create(tmp))
        {
            await data.CopyToAsync(fs, ct);
        }
        File.Move(tmp, path, overwrite: true);
    }

    private (string Path, string ContentType)? Find(Guid lotId, string pattern)
    {
        var dir = LotDir(lotId);
        if (!Directory.Exists(dir)) return null;
        var file = Directory.GetFiles(dir, pattern).FirstOrDefault(f => !f.EndsWith(".tmp"));
        return file is null ? null : (file, ContentTypeOf(file));
    }

    private bool DeleteMatching(Guid lotId, string pattern)
    {
        var dir = LotDir(lotId);
        if (!Directory.Exists(dir)) return false;
        var removed = false;
        foreach (var f in Directory.GetFiles(dir, pattern))
            removed |= TryDelete(f);
        return removed;
    }

    private static bool TryDelete(string path)
    {
        try { File.Delete(path); return true; }
        catch { return false; }
    }

    private static string ContentTypeOf(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.');
        return TypeByExt.GetValueOrDefault(ext, "application/octet-stream");
    }

    private static string StripPrefixAndExt(string fileName, string prefix)
    {
        var name = fileName[prefix.Length..];
        var dot = name.LastIndexOf('.');
        return dot > 0 ? name[..dot] : name;
    }
}
