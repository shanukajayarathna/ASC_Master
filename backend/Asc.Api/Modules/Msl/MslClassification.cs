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

    private static readonly (Regex Re, string Category)[] CategoryRules =
    [
        (new Regex(@"^(GT|GP|CGT|C\.?S|CH\b|SEN|GUN|CEYLON\s)", RegexOptions.Compiled), "Green Tea"),
        (new Regex(@"^BOP1A", RegexOptions.Compiled), "BOP1A"),
        (new Regex(@"^(DUST|PD|D)\d*\b", RegexOptions.Compiled), "Dust"),
        (new Regex(@"EX\.?SP|^FF", RegexOptions.Compiled), "Premium Flowery"),
        (new Regex(@"^(FBOP1|FBOPF1|FBOPF\b|FBOPFSP)", RegexOptions.Compiled), "Tippy"),
        (new Regex(@"^(FBOP\b|FBOPSP|BOP1\b|FP\b)", RegexOptions.Compiled), "Semi Leafy"),
        (new Regex(@"^(OP|PEK)", RegexOptions.Compiled), "Leafy"),
        (new Regex(@"^(BOP\b|BOPF|BOPSP|BOPFSP|BP1\b|PF1\b)", RegexOptions.Compiled), "High & Medium"),
        (new Regex(@"^(BM\b|BT\b|BOPA|FGS|BP\b|PF\b|BPS)", RegexOptions.Compiled), "Off Grade"),
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
        var gradeType = category is "Off Grade" or "Dust" ? "Off Grade" : "Main Grade";
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
