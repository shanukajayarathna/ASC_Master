namespace Asc.Api.Modules.FactoryGrademix;

/// <summary>One grade going into a grademix table: quantity in kg and, when known, its Rs/kg
/// price. A grade with no price is listed but excluded from shares and averages.</summary>
public record GradeInput(string Grade, decimal Qty, decimal? Price);

/// <summary>
/// Pure grademix arithmetic — no I/O — for the company's grademix sheet (MAIN GRADE / OFF GRADE
/// tables plus the leafy summary). The contribution rule was reverse-engineered from the company's
/// own printed sheet and checks out to the cent against it: ContriValue = (group avg - national
/// avg) x group qty%, and the groups add up to (factory avg - national avg).
/// </summary>
public static class FactoryGrademixEngine
{
    // Off grades and leafy groupings exactly as the company's sheet lists them. Keys are
    // normalized (upper-case letters and digits only) so "FBOPF Sp"/"FBOPFSP" style spelling drift
    // doesn't split a grade. Every grade not listed as off grade is a main grade.
    private static readonly HashSet<string> OffGrades = ["BM", "BOP1A", "BP", "DUST", "FGS", "FNGS", "FNGS1", "BT"];

    private static readonly (string Name, HashSet<string> Grades)[] LeafyGroups =
    [
        ("PEK/PEK1", ["PEK", "PEK1", "PEKOE", "PEKOE1"]),
        ("OP/OPA", ["OP", "OPA"]),
        ("OP1/BOP1", ["OP1", "BOP1"]),
    ];

    public static string NormalizeGrade(string? grade) =>
        new([.. (grade ?? string.Empty).ToUpperInvariant().Where(char.IsLetterOrDigit)]);

    public static bool IsOffGrade(string? grade) => OffGrades.Contains(NormalizeGrade(grade));

    public static GrademixTableDto Build(
        IReadOnlyList<GradeInput> inputs, decimal nationalAvg,
        IReadOnlyDictionary<string, decimal>? prevQtyPct = null,
        IReadOnlyDictionary<string, string>? priceBasis = null)
    {
        var priced = inputs.Where(i => i.Qty > 0 && i.Price is > 0).ToList();
        var totalQty = priced.Sum(i => i.Qty);
        var unpricedKg = inputs.Where(i => i.Qty > 0 && i.Price is not > 0).Sum(i => i.Qty);

        GradeRowDto Row(GradeInput i)
        {
            var isPriced = i.Price is > 0;
            return new GradeRowDto(
                i.Grade, i.Qty, isPriced ? i.Price : null,
                isPriced && totalQty > 0 ? i.Qty / totalQty * 100m : null,
                prevQtyPct is not null && prevQtyPct.TryGetValue(NormalizeGrade(i.Grade), out var p) ? p : null,
                priceBasis is not null && priceBasis.TryGetValue(NormalizeGrade(i.Grade), out var b) ? b : null);
        }

        List<GradeRowDto> Rows(bool off) => inputs
            .Where(i => i.Qty > 0 && IsOffGrade(i.Grade) == off)
            .OrderBy(i => i.Grade, StringComparer.OrdinalIgnoreCase)
            .Select(Row).ToList();

        GroupRowDto Group(string name, Func<GradeInput, bool> member)
        {
            var g = priced.Where(member).ToList();
            var qty = g.Sum(i => i.Qty);
            if (qty == 0 || totalQty == 0) return new GroupRowDto(name, 0, 0, null, 0);
            var avg = g.Sum(i => i.Qty * i.Price!.Value) / qty;
            return new GroupRowDto(name, qty, qty / totalQty * 100m, avg, (avg - nationalAvg) * qty / totalQty);
        }

        var allLeafy = LeafyGroups.SelectMany(l => l.Grades).ToHashSet();
        bool InLeafy(GradeInput i) => allLeafy.Contains(NormalizeGrade(i.Grade));
        bool IsMain(GradeInput i) => !IsOffGrade(i.Grade);

        var leafy = LeafyGroups.Select(l => Group(l.Name, i => l.Grades.Contains(NormalizeGrade(i.Grade)))).ToList();
        var totalLeafy = Group("Total leafy", InLeafy);
        var small = Group("Small leafy", i => IsMain(i) && !InLeafy(i));
        var off = Group("Off grade", i => !IsMain(i));
        var totalMain = Group("Total main", IsMain);
        var all = Group("All lots", _ => true);

        return new GrademixTableDto(
            Rows(false), Rows(true), totalMain, off with { Name = "Total off" }, all,
            leafy, totalLeafy, small, off,
            totalLeafy.ContriValue + small.ContriValue + off.ContriValue,
            all.AvgRs, nationalAvg, unpricedKg);
    }
}
