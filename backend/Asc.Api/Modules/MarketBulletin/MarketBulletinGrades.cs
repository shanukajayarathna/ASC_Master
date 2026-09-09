namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Grade groupings for the Weekly Market Bulletin report. These lists were built from the
/// real `Category` column that every broker's sale file already carries (verified directly
/// against `data/sales/2026/33.xlsx`, all 8 brokers, 11,335 lots) — Leafy/Semi Leafy/Tippy/
/// Premium Flowery/Off Grade/Dust/High and Medium/Ex-estate/BOP1A are the tea trade's own
/// classification, not an invented grouping. Two deliberate overrides of that raw data (both
/// confirmed with the user): BOP1A's own category is folded into Off Grade here, and the
/// CTC-ish grades that otherwise leak into "High and Medium"/"Ex-estate" (BP1, BPS, OF, PF1)
/// are pulled out into Unorthodox so they're shown exactly once, not duplicated.
///
/// Membership is still decided by exact Grade string + Elevation code (LotsForFamily +
/// IsHighElevation/IsMediumElevation/IsLowElevation in MarketBulletinEngine), NOT by reading
/// Lot.Category live — the raw Category column does not cleanly separate by elevation (a
/// "High and Medium"-tagged lot can carry elevation "L" in real data), so trusting it directly
/// would blur Low Grown into High and Medium. Ex-estate is the one exception: it has no
/// elevation restriction to worry about and the user wants "whatever's really there,
/// alphabetically" rather than a fixed list, so that one section reads Lot.Category directly
/// (see MarketBulletinEngine.BuildExEstate).
/// </summary>
public static class MarketBulletinGrades
{
    // ---- Low Grown's three leaf-style subsections (elevation "L" only) -----------------
    // Order within each list is the user's own specified order, not alphabetical.

    public static readonly string[] LeafyGrades = ["OP1", "OP", "OPA"];
    public static readonly string[] SemiLeafyGrades = ["BOP1", "PEK", "PEK1"];
    public static readonly string[] TippyGrades = ["BOP", "BOPSp", "BOPF", "BOPFSp", "BOPA", "FBOP", "FBOP1", "FBOPF", "FBOPF1"];

    // High and Medium reuses these same three lists/order, just scoped to WH/UH/WM/UM
    // elevation instead of L (see BuildHighAndMedium) — it's genuinely the same 15 grades,
    // just at a different elevation band, confirmed by the real Category data.

    public static readonly string[] PremiumFloweryGrades = ["FBOPFSp", "FBOPFExSp", "FBOPFExSp1"];

    public static readonly string[] OffGradeGrades = ["BM", "BP", "BT", "FGS", "FGS1", "PF", "BOP1A"];

    public static readonly string[] DustGrades = ["PD", "DUST1", "DUST"];

    /// <summary>The CTC-ish grades real data tags under "High and Medium" or "Ex-estate"
    /// alongside genuinely Orthodox grades — pulled out into their own section instead, and
    /// excluded from High and Medium/Ex-estate's own lot pools so nothing is shown twice.</summary>
    public static readonly string[] UnorthodoxGrades = ["BP1", "BPS", "OF", "PF1"];
}
