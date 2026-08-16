using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Standard Ceylon grade classification — grade → category / grade type / tea type /
/// manufacture (CTC vs Orthodox). These are the trade's conventional groupings (the same
/// dimensions the external Power BI portal filters on); individual grades can be
/// re-grouped later via the Master Data admin screen if ASC's own convention differs.
/// Order matters: first matching rule wins.
/// </summary>
public static class MslClassification
{
    public record GradeClass(string Category, string GradeType, string TeaType, string Manufacture);

    /// <summary>The company's exact Off Grade set, solved against the Power BI portal's
    /// Factory Grade Mix for sale 30/2026 (group totals reconcile to the cent: Off
    /// 1,181,269 kg @ Rs 711.05, Main 3,973,781 kg @ Rs 1,301.20). Base off grades plus
    /// their green-tea variants (GT/CGT prefix). Notably Main: DUST1, PD, PF1, BP1, BPS,
    /// BOPA.</summary>
    private static readonly HashSet<string> OffGradeBases = new(StringComparer.OrdinalIgnoreCase)
        { "BM", "BOP1A", "BP", "BT", "DUST", "FGS", "FGS1", "PF" };

    public static bool IsOffGrade(string grade)
    {
        var g = Regex.Replace(grade.ToUpperInvariant(), "[^A-Z0-9]", "");
        if (g == "CGTSPHY") return true; // per the portal's list; GTSPHY stays Main
        if (OffGradeBases.Contains(g)) return true;
        foreach (var prefix in (string[])["CGT", "GT"])
            if (g.StartsWith(prefix, StringComparison.Ordinal) && OffGradeBases.Contains(g[prefix.Length..]))
                return true;
        return false;
    }

    private static readonly (Regex Re, string Category)[] CategoryRules =
    [
        (new Regex(@"^(GT|GP|CGT|C\.?S|CH\b|SEN|GUN|CEYLON\s)", RegexOptions.Compiled), "Green Tea"),
        (new Regex(@"^BOP1A", RegexOptions.Compiled), "BOP1A"),
        (new Regex(@"^(DUST|PD|D)\d*\b", RegexOptions.Compiled), "Dust"),
        (new Regex(@"EX\.?SP|^FF", RegexOptions.Compiled), "Premium Flowery"),
        (new Regex(@"^(FBOP1|FBOPF1|FBOPF\b|FBOPFSP)", RegexOptions.Compiled), "Tippy"),
        (new Regex(@"^(FBOP\b|FBOPSP|BOP1\b|FP\b)", RegexOptions.Compiled), "Semi Leafy"),
        (new Regex(@"^(OP|PEK)", RegexOptions.Compiled), "Leafy"),
        (new Regex(@"^(BOP\b|BOPF|BOPSP|BOPFSP|BOPA|BP1\b|PF1\b|BPS)", RegexOptions.Compiled), "High & Medium"),
        (new Regex(@"^(BM\b|BT\b|FGS|BP\b|PF\b)", RegexOptions.Compiled), "Off Grade"),
    ];

    private static readonly Regex CtcRe = new(@"^(BP1?|PF1?|PD1?)\b|CTC", RegexOptions.Compiled);

    private static readonly Dictionary<string, GradeClass> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Lock CacheLock = new();

    public static GradeClass Classify(string grade)
    {
        grade = grade.Trim().ToUpperInvariant();
        lock (CacheLock)
        {
            if (Cache.TryGetValue(grade, out var hit)) return hit;
        }
        var category = "Other";
        foreach (var (re, cat) in CategoryRules)
        {
            if (re.IsMatch(grade)) { category = cat; break; }
        }
        var teaType = category == "Green Tea" ? "Green Tea" : "Black Tea";
        // Grade type follows the portal-verified rule, NOT the category — DUST1/PD are
        // category "Dust" yet Main Grade, exactly as the company's own report groups them.
        var gradeType = IsOffGrade(grade) ? "Off Grade" : "Main Grade";
        var manufacture = CtcRe.IsMatch(grade) ? "CTC" : "Orthodox";
        var result = new GradeClass(category, gradeType, teaType, manufacture);
        lock (CacheLock)
        {
            Cache[grade] = result;
        }
        return result;
    }

    /// <summary>All grades from <paramref name="knownGrades"/> whose classification matches
    /// the requested filter values — the server-side translation of a category/type filter
    /// into a plain $in over the indexed grade field.</summary>
    public static HashSet<string> GradesMatching(
        IEnumerable<string> knownGrades,
        IReadOnlyCollection<string>? categories,
        IReadOnlyCollection<string>? gradeTypes,
        IReadOnlyCollection<string>? teaTypes,
        IReadOnlyCollection<string>? manufactures)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in knownGrades)
        {
            var c = Classify(g);
            if (categories is { Count: > 0 } && !categories.Contains(c.Category, StringComparer.OrdinalIgnoreCase)) continue;
            if (gradeTypes is { Count: > 0 } && !gradeTypes.Contains(c.GradeType, StringComparer.OrdinalIgnoreCase)) continue;
            if (teaTypes is { Count: > 0 } && !teaTypes.Contains(c.TeaType, StringComparer.OrdinalIgnoreCase)) continue;
            if (manufactures is { Count: > 0 } && !manufactures.Contains(c.Manufacture, StringComparer.OrdinalIgnoreCase)) continue;
            result.Add(g);
        }
        return result;
    }
}
