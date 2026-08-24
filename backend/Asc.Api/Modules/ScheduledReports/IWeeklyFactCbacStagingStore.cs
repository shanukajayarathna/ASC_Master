namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// Staging area for the CBAC elevation-average TXT — the one Weekly FACT input with no
/// database equivalent (see MslWeeklyReportService's own doc comment: its Orthodox/CTC
/// benchmark split isn't reliably derivable from lot-level data). An admin uploads it here
/// whenever it arrives during the week, independent of when the sale itself closes;
/// WeeklyFactAutoReportJob checks for a staged file keyed by (year, saleNo) on every tick and
/// only generates once both the sale has closed AND its CBAC text is present. Same disk-backed
/// seam shape as every other *Store in this app (ILotMediaStore, IDocumentStore,
/// IGeneratedReportFileStore) — local disk now, swappable later.
/// </summary>
public interface IWeeklyFactCbacStagingStore
{
    Task StageAsync(int saleYear, int saleNo, string txtContent, CancellationToken ct = default);
    Task<string?> GetAsync(int saleYear, int saleNo, CancellationToken ct = default);
    bool Delete(int saleYear, int saleNo);
    List<(int SaleYear, int SaleNo, DateTime StagedAt)> ListStaged();
}

/// <summary>Stores each staged CBAC TXT as data/weekly-fact-cbac/{year}-{saleNo}/original.txt.</summary>
public class LocalWeeklyFactCbacStagingStore(IWebHostEnvironment env) : IWeeklyFactCbacStagingStore
{
    public string RootDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "weekly-fact-cbac"));
    private string SaleDir(int saleYear, int saleNo) => Path.Combine(RootDir, $"{saleYear}-{saleNo}");

    public async Task StageAsync(int saleYear, int saleNo, string txtContent, CancellationToken ct = default)
    {
        var dir = SaleDir(saleYear, saleNo);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "original.txt");
        var tmp = path + ".tmp";
        await File.WriteAllTextAsync(tmp, txtContent, ct);
        File.Move(tmp, path, overwrite: true);
    }

    public async Task<string?> GetAsync(int saleYear, int saleNo, CancellationToken ct = default)
    {
        var path = Path.Combine(SaleDir(saleYear, saleNo), "original.txt");
        return File.Exists(path) ? await File.ReadAllTextAsync(path, ct) : null;
    }

    public bool Delete(int saleYear, int saleNo)
    {
        var dir = SaleDir(saleYear, saleNo);
        if (!Directory.Exists(dir)) return false;
        try { Directory.Delete(dir, recursive: true); return true; }
        catch { return false; }
    }

    public List<(int SaleYear, int SaleNo, DateTime StagedAt)> ListStaged()
    {
        if (!Directory.Exists(RootDir)) return [];
        var results = new List<(int, int, DateTime)>();
        foreach (var dir in Directory.GetDirectories(RootDir))
        {
            var name = Path.GetFileName(dir);
            var parts = name.Split('-');
            var file = Path.Combine(dir, "original.txt");
            if (parts.Length == 2 && int.TryParse(parts[0], out var year) && int.TryParse(parts[1], out var saleNo) && File.Exists(file))
                results.Add((year, saleNo, File.GetLastWriteTimeUtc(file)));
        }
        return results;
    }
}
