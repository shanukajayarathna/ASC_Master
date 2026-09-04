namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Grade groupings for the Weekly Market Bulletin report, matching the printed bulletin's
/// own tables. Some grades are pooled together into one family (e.g. BOP1 and OP1 are
/// tiered as a single "BOP1/OP1" pool) rather than reported separately.
/// </summary>
public static class MarketBulletinGrades
{
    public sealed record GradeFamily(string Label, string[] Grades);

    public static readonly GradeFamily[] HighMediumGrown =
    [
        new("BOP", ["BOP"]),
        new("BOPF", ["BOPF"]),
    ];

    public static readonly GradeFamily[] Unorthodox =
    [
        new("BP1", ["BP1"]),
        new("PF1", ["PF1"]),
    ];

    public static readonly GradeFamily[] HmOrthodoxBlackTea =
    [
        new("BOP1/OP1", ["BOP1", "OP1"]),
        new("FBOP/FBOP1", ["FBOP", "FBOP1"]),
        new("OP/OPA", ["OP", "OPA"]),
        new("FBOPF1", ["FBOPF1"]),
        new("PEKOE/PEKOE1", ["PEK", "PEK1"]),
        new("BOP/BOPSP", ["BOP", "BOPSP"]),
    ];

    public static readonly GradeFamily[] OffGrades =
    [
        new("FGS1/FGS", ["FGS1", "FGS"]),
        new("BOP1A/BM", ["BOP1A", "BM"]),
        new("BP", ["BP"]),
    ];

    // Confirmed against real Sale 51/2024 data (8,411 lots): every Category="Dust" lot uses
    // exactly one of these three grade codes — DUST/DUST1 Orthodox, PD CTC (matches
    // MslClassification's CTC set). There is no distinct "Secondary" dust grade code anywhere
    // in that sale, so a Secondary table is deliberately not modeled — it would always render
    // "NA" and that's not worth a permanently-empty section in a printed bulletin.
    public static readonly string[] PrimaryOrthodoxDustGrades = ["DUST1", "DUST"];
    public static readonly string[] PrimaryCtcDustGrades = ["PD"];

    public static readonly GradeFamily[] LowGrown =
    [
        new("FBOP1", ["FBOP1"]),
        new("FBOP", ["FBOP"]),
        new("FBOPF1", ["FBOPF1"]),
        new("FBOPF", ["FBOPF"]),
        new("FBOPFEXSP/SP", ["FBOPFEXSP", "SP"]),
        new("BOP1", ["BOP1"]),
        new("OP1", ["OP1"]),
        new("OP", ["OP"]),
        new("OPA", ["OPA"]),
        new("PEK", ["PEK"]),
        new("PEK1", ["PEK1"]),
        new("BOP", ["BOP"]),
        new("BOPF", ["BOPF"]),
    ];
}
