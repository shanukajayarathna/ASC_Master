using System.Globalization;
using System.Text.RegularExpressions;
using Asc.Api.Modules.Msl.FactoryAverages;

namespace Asc.Api.Modules.Msl.PlantationRanking;

/// <summary>
/// Parser for the monthly "PERFORMANCE OF COMPANIES AS AT END OF &lt;MONTH&gt; &lt;YEAR&gt;" plantation-ranking
/// reports (data/msl/plantation-ranking/&lt;year&gt;/plantation-ranking-YYYY-MM[-overall].txt), 2018 to 2020.
/// Each elevation lists its plantation companies (name, month quantity + rank, month average + rank, then
/// the same four figures year to date) with the brokers that sold for each company indented beneath
/// (quantity and average only), and closes with a TOTAL line. The eight number columns sit at slightly
/// different positions in different print runs, so they are learnt from each file's company lines.
/// </summary>
public static partial class PlantationRankingParser
{
    public record Parsed(int Year, int Month, List<PlantationRankingRow> Rows);

    private static readonly string[] MonthNames =
        ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    private const int NumberAreaStart = 20;
    private const int Tolerance = 3;

    [GeneratedRegex(@"AS AT END OF\s+([A-Z]+)\s+(\d{4})", RegexOptions.IgnoreCase)]
    private static partial Regex TitleRe();

    [GeneratedRegex(@"-?\d[\d,]*(?:\.\d+)?")]
    private static partial Regex NumberRe();

    [GeneratedRegex(@"^ELEVATION\s*:\s*(.+?)\s*(?:TIME:.*|\d{1,2}\.\d{1,2}\.\d{2}|)$")]
    private static partial Regex ElevationRe();

    /// <summary>Returns null when the text isn't a plantation-ranking report; throws <see cref="FormatException"/>
    /// when it is but a line doesn't fit.</summary>
    public static Parsed? Parse(string text, string sourceFile)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var title = lines.Take(4).Select(l => TitleRe().Match(l)).FirstOrDefault(m => m.Success);
        if (title is null) return null;
        var monthIdx = Array.IndexOf(MonthNames, title.Groups[1].Value.ToUpperInvariant());
        if (monthIdx < 0) return null;
        int year = int.Parse(title.Groups[2].Value, CultureInfo.InvariantCulture), month = monthIdx + 1;

        // ---- pass 1: classify lines and learn the eight columns from the company lines ----
        var items = new List<(string Elevation, string Label, bool Indented, List<Match> Nums, string Line)>();
        string? elevation = null;
        foreach (var raw in lines)
        {
            var l = raw.TrimEnd();
            if (l.All(c => char.IsWhiteSpace(c) || char.IsControl(c))) continue;
            var t = l.Trim();
            var upper = t.ToUpperInvariant();

            if (ElevationRe().Match(t) is { Success: true } em && upper.StartsWith("ELEVATION", StringComparison.Ordinal))
            {
                elevation = NormalizeElevation(em.Groups[1].Value);
                continue;
            }
            if (upper.StartsWith("PERFORMANCE OF COMP", StringComparison.Ordinal) || upper.StartsWith("PERRFORMANCE", StringComparison.Ordinal) ||
                upper.StartsWith("COMPANY NAME", StringComparison.Ordinal) || upper.StartsWith("PAGE", StringComparison.Ordinal) ||
                upper.StartsWith("M O N T H", StringComparison.Ordinal) || Regex.IsMatch(t, @"^[-=\s]+$") ||
                upper.Contains("E N D   O F", StringComparison.Ordinal) || upper.StartsWith("------------", StringComparison.Ordinal))
                continue;

            var nums = NumberRe().Matches(l).Where(m => m.Index >= NumberAreaStart).ToList();
            var first = nums.FirstOrDefault();
            var label = (first is null ? l : l[..first.Index]).Trim();
            if (elevation is null) throw new FormatException($"Line before any ELEVATION heading: '{t}'");
            items.Add((elevation, label, l.StartsWith(' '), nums, l));
        }

        var companyEnds = items.Where(i => !i.Indented && i.Nums.Count >= 8 && !IsTotalLabel(i.Label))
            .SelectMany(i => i.Nums.Select(n => n.Index + n.Length)).ToList();
        var cols = LearnColumns(companyEnds);
        int[] measure = [0, 2, 4, 6];   // month qty, month avg, todate qty, todate avg

        // ---- pass 2: rows ----
        var rows = new List<PlantationRankingRow>();
        string? company = null;
        foreach (var (elev, label, indented, nums, line) in items)
        {
            if (label.Length == 0) continue; // repeated figures line (older layout) — no name, nothing new
            if (IsTotalLabel(label))
            {
                var c = Assign(nums, cols, measure, line);
                rows.Add(Build(year, month, elev, PlantationRowType.Total, null, null, c, sourceFile));
                company = null;
                continue;
            }
            if (!indented || nums.Count >= 8)
            {
                company = label;
                rows.Add(Build(year, month, elev, PlantationRowType.Company, label, null, Assign(nums, cols, Enumerable.Range(0, 8).ToArray(), line), sourceFile));
            }
            else
            {
                if (company is null) throw new FormatException($"Broker line with no company above it: '{line.Trim()}'");
                rows.Add(Build(year, month, elev, PlantationRowType.Broker, company, label, Assign(nums, cols, measure, line), sourceFile));
            }
        }
        return new Parsed(year, month, rows);
    }

    private static bool IsTotalLabel(string label) => label.Replace(" ", "").Equals("TOTAL", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeElevation(string s)
    {
        var cleaned = Regex.Replace(s.ToUpperInvariant(), "[^A-Z]", " ").Trim();
        return cleaned.Contains("OVERALL", StringComparison.Ordinal) ? "OVERALL" : Regex.Replace(cleaned, @"\s+", " ");
    }

    /// <summary>The eight column right-edges: the most common end positions, neighbours within 2 merged.</summary>
    private static int[] LearnColumns(List<int> ends)
    {
        var groups = new List<List<int>>();
        foreach (var e in ends.OrderBy(x => x))
        {
            if (groups.Count > 0 && e - groups[^1][^1] <= 2) groups[^1].Add(e);
            else groups.Add([e]);
        }
        var top = groups.OrderByDescending(g => g.Count).Take(8).Select(g => (int)Math.Round(g.Average())).OrderBy(x => x).ToArray();
        if (top.Length != 8) throw new FormatException($"Expected eight number columns in the company lines, found {top.Length}.");
        return top;
    }

    private static decimal?[] Assign(List<Match> nums, int[] cols, int[] allowed, string line)
    {
        var cells = new decimal?[8];
        foreach (var m in nums)
        {
            var end = m.Index + m.Length;
            var col = allowed.OrderBy(i => Math.Abs(cols[i] - end)).First();
            if (Math.Abs(cols[col] - end) > Tolerance)
                throw new FormatException($"Number '{m.Value}' ends at column {end}, not under a report column: '{line.Trim()}'");
            cells[col] = decimal.Parse(m.Value.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
        return cells;
    }

    private static PlantationRankingRow Build(int year, int month, string elevation, string rowType, string? company, string? broker, decimal?[] c, string source) => new()
    {
        Year = year,
        Month = month,
        Elevation = elevation,
        RowType = rowType,
        Company = company,
        Broker = broker,
        MonthQtyKg = c[0],
        MonthQtyRank = c[1] is { } a ? (int)a : null,
        MonthAvgRs = c[2],
        MonthAvgRank = c[3] is { } b ? (int)b : null,
        TodateQtyKg = c[4],
        TodateQtyRank = c[5] is { } d ? (int)d : null,
        TodateAvgRs = c[6],
        TodateAvgRank = c[7] is { } e ? (int)e : null,
        SourceFile = source,
    };

    /// <summary>Checks a parsed month: each company's brokers must add up to the company's quantity, and each
    /// elevation's companies to its TOTAL line (month and year-to-date quantities). Empty means consistent.</summary>
    public static List<string> Reconcile(Parsed p)
    {
        var problems = new List<string>();
        static bool Differs(decimal a, decimal b) => Math.Abs(a - b) > Math.Max(1m, Math.Abs(b) * 0.00001m);

        foreach (var e in p.Rows.Select(r => r.Elevation).Distinct())
        {
            var er = p.Rows.Where(r => r.Elevation == e).ToList();
            foreach (var co in er.Where(r => r.RowType == PlantationRowType.Company))
            {
                var brokers = er.Where(r => r.RowType == PlantationRowType.Broker && r.Company == co.Company).ToList();
                if (brokers.Count == 0) continue;
                if (Differs(brokers.Sum(b => b.MonthQtyKg ?? 0), co.MonthQtyKg ?? 0))
                    problems.Add($"{e} {co.Company}: brokers add to {brokers.Sum(b => b.MonthQtyKg ?? 0):N1} kg but the company line says {co.MonthQtyKg ?? 0:N1}");
            }
            if (er.FirstOrDefault(r => r.RowType == PlantationRowType.Total) is { } total)
            {
                var sum = er.Where(r => r.RowType == PlantationRowType.Company).Sum(r => r.MonthQtyKg ?? 0);
                if (Differs(sum, total.MonthQtyKg ?? 0))
                    problems.Add($"{e}: companies add to {sum:N1} kg but TOTAL says {total.MonthQtyKg ?? 0:N1}");
            }
        }
        return problems;
    }

    public static string DecodeText(byte[] raw) => FactoryAveragesParser.DecodeText(raw);
}
