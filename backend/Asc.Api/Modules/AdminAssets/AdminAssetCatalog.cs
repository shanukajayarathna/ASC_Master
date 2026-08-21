namespace Asc.Api.Modules.AdminAssets;

/// <summary>
/// One admin-uploadable file slot: a fixed, known place in the app (a report template, the
/// export letterhead logo) that ships with a bundled default and can be overridden by an
/// Admin without a redeploy. Deliberately a closed whitelist, resolved by Id only — an
/// upload can never land at an arbitrary path the client picks.
/// </summary>
public sealed record AdminAssetSlot(
    string Id,
    string Group,
    string Label,
    string Description,
    /// <summary>Path under data/, forward-slash separated.</summary>
    string RelativePath,
    string[] AllowedExtensions,
    string ContentType)
{
    public string FileName => RelativePath[(RelativePath.LastIndexOf('/') + 1)..];
}

public static class AdminAssetCatalog
{
    private const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>Mirrors frontend/src/lib/weeklyFactReport.ts's template keys/paths and
    /// WorksheetExcelBuilder's logo path exactly — those are the two places these files get
    /// read back on the other end.</summary>
    public static readonly IReadOnlyList<AdminAssetSlot> Slots = new List<AdminAssetSlot>
    {
        new("fact-uh", "FACT Templates", "Uva High", "Weekly FACT ranking workbook template — Uva High category.", "templates/fact/fact-uh.xlsx", ["xlsx"], XlsxContentType),
        new("fact-um", "FACT Templates", "Uva Medium", "Weekly FACT ranking workbook template — Uva Medium category.", "templates/fact/fact-um.xlsx", ["xlsx"], XlsxContentType),
        new("fact-wh", "FACT Templates", "Western High", "Weekly FACT ranking workbook template — Western High category.", "templates/fact/fact-wh.xlsx", ["xlsx"], XlsxContentType),
        new("fact-wm", "FACT Templates", "Western Medium", "Weekly FACT ranking workbook template — Western Medium category.", "templates/fact/fact-wm.xlsx", ["xlsx"], XlsxContentType),

        new("rank-uh", "RANK Templates", "Uva High", "Combined RANK workbook template — Uva High category.", "templates/rank/rank-uh.xlsx", ["xlsx"], XlsxContentType),
        new("rank-um", "RANK Templates", "Uva Medium", "Combined RANK workbook template — Uva Medium category.", "templates/rank/rank-um.xlsx", ["xlsx"], XlsxContentType),
        new("rank-wh", "RANK Templates", "Western High", "Combined RANK workbook template — Western High category.", "templates/rank/rank-wh.xlsx", ["xlsx"], XlsxContentType),
        new("rank-wm", "RANK Templates", "Western Medium", "Combined RANK workbook template — Western Medium category.", "templates/rank/rank-wm.xlsx", ["xlsx"], XlsxContentType),

        new("low-wise", "LOW Template", "Rank/Mark Wise", "Weekly LOW rank/mark-wise workbook template.", "templates/low/low-wise.xlsx", ["xlsx"], XlsxContentType),
        new("market-share", "Market Share Template", "Market Share", "Market share workbook template.", "templates/market-share/market-share.xlsx", ["xlsx"], XlsxContentType),

        new("logo", "Branding", "Export Letterhead Logo", "Company logo stamped onto generated Worksheet / Asking Price Excel exports.", "branding/logo.png", ["png"], "image/png"),
    };

    public static AdminAssetSlot? Find(string id) =>
        Slots.FirstOrDefault(s => string.Equals(s.Id, id, StringComparison.OrdinalIgnoreCase));
}
