using System.Globalization;
using System.Text.RegularExpressions;
using Asc.Api.Modules.Msl.FactoryAverages;

namespace Asc.Api.Modules.Msl.GradeAnalysis;

/// <summary>
/// Parser for the monthly "All Brokers' Monthly Elevation Wise Grade Analysis" reports
/// (data/msl/grade-analysis/&lt;year&gt;/grade-analysis-YYYY-MM[-all-elevations].txt), 2018 to early 2020.
/// Two print layouts exist — 2018's ("... AND AVERAGES", month/year on its own line, '*' after total
/// averages) and 2019 onward ("... &amp; AVERAGES - FEBRUARY 2019"); both have the same six number columns
/// (month qty / avg price / % share, then the same three year-to-date) at fixed positions, plus an
/// "all elevations" summary file with four (no percentages). A number is only read when it ends under a
/// known column, so a grade name containing a digit ("FBOPF1") can never be mistaken for a figure, and a
/// figure outside the columns fails the file loudly.
/// </summary>
public static partial class GradeAnalysisParser
{
    public record Parsed(int Year, int Month, List<GradeAnalysisRow> Rows);

    // Right edge of each column: month qty, avg, pct, todate qty, avg, pct.
    private static readonly int[] Ends2018 = [40, 60, 67, 80, 100, 107];
    private static readonly int[] Ends2019 = [50, 67, 78, 102, 119, 130];
    // The all-elevations summary has no percentage columns: month qty, avg, todate qty, avg.
    private static readonly int[] EndsAll = [50, 67, 86, 103];
    private const int Tolerance = 3;

    private static readonly string[] MonthNames =
        ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

    [GeneratedRegex(@"AVERAGES\s*-\s*([A-Z]+)\s+(\d{4})")]
    private static partial Regex Title2019Re();

    [GeneratedRegex(@"\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s+(20\d\d)\b")]
    private static partial Regex Title2018Re();

    [GeneratedRegex(@"-?\d[\d,]*(?:\.\d+)?|(?<![\d,])\.\d+")]
    private static partial Regex NumberRe();

    [GeneratedRegex(@"ELEVATION\s*:\s*([A-Z :]+?)\s*(?:PAGE|$)")]
    private static partial Regex ElevationRe();

    /// <summary>Returns null when the text isn't a grade-analysis report; throws <see cref="FormatException"/>
    /// when it is but a line doesn't fit the columns.</summary>
    public static Parsed? Parse(string text, string sourceFile)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var head = string.Join(" ", lines.Take(6)).ToUpperInvariant();
        if (!head.Contains("GRADE ANALYSIS", StringComparison.Ordinal)) return null;

        int year, month;
        bool layout2019;
        if (Title2019Re().Match(head) is { Success: true } m19 && Array.IndexOf(MonthNames, m19.Groups[1].Value) >= 0)
        {
            (month, year, layout2019) = (Array.IndexOf(MonthNames, m19.Groups[1].Value) + 1, int.Parse(m19.Groups[2].Value, CultureInfo.InvariantCulture), true);
        }
        else if (Title2018Re().Match(head) is { Success: true } m18)
        {
            var abbr = m18.Groups[1].Value;
            (month, year, layout2019) = (Array.FindIndex(MonthNames, n => n.StartsWith(abbr, StringComparison.Ordinal)) + 1,
                int.Parse(m18.Groups[2].Value, CultureInfo.InvariantCulture), false);
        }
        else return null;

        var isAll = Regex.IsMatch(head, @"ELEVATION\s*:\s*ALL\b");
        var ends = isAll ? EndsAll : layout2019 ? Ends2019 : Ends2018;

        var rows = new List<GradeAnalysisRow>();
        string? elevation = null;
        var group = "MAIN";
        // The 2018 reports close with an all-elevations summary that has no "ELEVATION :" heading, only a
        // "QUANTITY AVERAGE PRICE QUANTITY AVERAGE PRICE" header (no GRADE / PCTG columns).
        var summaryBlock = false;

        foreach (var raw in lines)
        {
            var l = raw.TrimEnd();
            if (l.All(c => char.IsWhiteSpace(c) || char.IsControl(c))) continue; // blank, or a ^Z end-of-file marker
            var upper = l.ToUpperInvariant();

            if (Regex.IsMatch(upper, @"^\s*QUANTITY\s+AVERAGE PRICE\s+QUANTITY\s+AVERAGE PRICE") && !upper.Contains("GRADE", StringComparison.Ordinal))
            {
                summaryBlock = true;
                continue;
            }
            if (summaryBlock)
            {
                if (IsBoilerplate(upper)) continue;
                var nums = NumberRe().Matches(l).Where(m => m.Index >= 20).Select(m => decimal.Parse(m.Value.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture)).ToList();
                var sLabel = NormalizeElevation(NumberRe().Replace(l, " "));
                if (nums.Count != 4) throw new FormatException($"Expected four figures in the summary line: '{l.Trim()}'");
                var isGrand = sLabel.Replace(" ", "").StartsWith("GRANDTOTAL", StringComparison.Ordinal);
                rows.Add(new GradeAnalysisRow
                {
                    Year = year, Month = month,
                    RowType = isGrand ? GradeAnalysisRowType.GrandTotal : GradeAnalysisRowType.ElevationSummary,
                    Elevation = isGrand ? null : sLabel,
                    MonthQtyKg = nums[0], MonthAvgRs = nums[1], TodateQtyKg = nums[2], TodateAvgRs = nums[3],
                    SourceFile = sourceFile,
                });
                continue;
            }

            if (ElevationRe().Match(upper) is { Success: true } em && !upper.Contains("ANALYSIS", StringComparison.Ordinal) && !upper.TrimStart().StartsWith("GRADE", StringComparison.Ordinal))
            {
                var e = NormalizeElevation(em.Groups[1].Value);
                if (e != elevation) group = "MAIN";
                elevation = e;
                continue;
            }
            if (IsBoilerplate(upper)) continue;

            var cells = Cells(l, ends);
            var first = FirstNumberIndex(l, ends);
            var label = (first < 0 ? l : l[..first]).Trim();
            var compact = label.Replace(" ", "").ToUpperInvariant();

            string rowType;
            string? gradeGroup = null, grade = null, rowElevation = elevation;
            if (compact.StartsWith("MAINGRADESTOTAL", StringComparison.Ordinal)) { rowType = GradeAnalysisRowType.MainTotal; gradeGroup = "MAIN"; group = "OFF"; }
            else if (compact.StartsWith("OFFGRADESTOTAL", StringComparison.Ordinal)) { rowType = GradeAnalysisRowType.OffTotal; gradeGroup = "OFF"; }
            else if (compact.StartsWith("ELEVATIONTOTAL", StringComparison.Ordinal) || compact.StartsWith("ELEVATIONALTOTAL", StringComparison.Ordinal)) { rowType = GradeAnalysisRowType.ElevationTotal; group = "MAIN"; }
            else if (compact.StartsWith("GRANDTOTAL", StringComparison.Ordinal)) { rowType = GradeAnalysisRowType.GrandTotal; rowElevation = null; }
            else if (isAll)
            {
                rowType = GradeAnalysisRowType.ElevationSummary;
                rowElevation = NormalizeElevation(label);
            }
            else
            {
                if (label.Length == 0 || elevation is null)
                    throw new FormatException($"Unrecognised line in grade analysis report: '{l.Trim()}'");
                rowType = GradeAnalysisRowType.Grade;
                gradeGroup = group;
                grade = label;
            }

            rows.Add(new GradeAnalysisRow
            {
                Year = year,
                Month = month,
                RowType = rowType,
                Elevation = rowElevation,
                GradeGroup = gradeGroup,
                Grade = grade,
                MonthQtyKg = cells[0],
                MonthAvgRs = cells[1],
                MonthPct = isAll ? null : cells[2],
                TodateQtyKg = isAll ? cells[2] : cells[3],
                TodateAvgRs = isAll ? cells[3] : cells[4],
                TodatePct = isAll ? null : cells[5],
                SourceFile = sourceFile,
            });
        }
        return new Parsed(year, month, rows);
    }

    private static bool IsBoilerplate(string upper)
    {
        var t = upper.Trim();
        return t.StartsWith("ASIA SIYAKA", StringComparison.Ordinal) || t.Contains("ANALYSIS", StringComparison.Ordinal) ||
               t.StartsWith("MONTH", StringComparison.Ordinal) || t.StartsWith("GRADE", StringComparison.Ordinal) ||
               t.StartsWith("ELEVATION ", StringComparison.Ordinal) && t.Contains("QUANT", StringComparison.Ordinal) ||
               t.StartsWith("---", StringComparison.Ordinal) || t.StartsWith("===", StringComparison.Ordinal) ||
               t.Contains("E N D   O F   R E P O R T", StringComparison.Ordinal) ||
               Regex.IsMatch(t, @"^-+(\s+-+)*$") || Regex.IsMatch(t, @"^={3,}(\s+={3,})*$") ||
               Regex.IsMatch(t, @"^[A-Z]{3}\s+20\d\d\s+\d+$") || Regex.IsMatch(t, @"^\d+$");
    }

    private static string NormalizeElevation(string s)
    {
        var cleaned = Regex.Replace(Regex.Replace(s.ToUpperInvariant(), "[^A-Z ]", " "), @"\s+", " ").Trim();
        return cleaned;
    }

    /// <summary>Numbers on the line that end under a report column, in column order (null where blank).</summary>
    private static decimal?[] Cells(string line, int[] ends)
    {
        var cells = new decimal?[ends.Length];
        foreach (Match m in NumberRe().Matches(line))
        {
            var col = ColumnOf(m, ends);
            if (col < 0) continue;
            cells[col] = decimal.Parse(m.Value.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
        return cells;
    }

    private static int FirstNumberIndex(string line, int[] ends)
    {
        foreach (Match m in NumberRe().Matches(line))
            if (ColumnOf(m, ends) >= 0) return m.Index;
        return -1;
    }

    private static int ColumnOf(Match m, int[] ends)
    {
        var end = m.Index + m.Length;
        var col = 0;
        for (var i = 1; i < ends.Length; i++)
            if (Math.Abs(ends[i] - end) < Math.Abs(ends[col] - end)) col = i;
        return Math.Abs(ends[col] - end) <= Tolerance ? col : -1;
    }

    /// <summary>Checks a parsed month against its own printed totals: each elevation's main grades must add
    /// up to its MAIN TOTAL, off grades to OFF TOTAL, and both to the ELEVATION TOTAL (month quantities);
    /// in the all-elevations file the elevations must add up to the GRAND TOTAL. Empty means consistent.</summary>
    public static List<string> Reconcile(Parsed p)
    {
        var problems = new List<string>();
        static bool Differs(decimal a, decimal b) => Math.Abs(a - b) > Math.Max(1m, Math.Abs(b) * 0.000001m);

        foreach (var e in p.Rows.Where(r => r.Elevation is not null && r.RowType != GradeAnalysisRowType.ElevationSummary).Select(r => r.Elevation!).Distinct())
        {
            var mine = p.Rows.Where(r => r.Elevation == e).ToList();
            decimal Sum(string group) => mine.Where(r => r.RowType == GradeAnalysisRowType.Grade && r.GradeGroup == group).Sum(r => r.MonthQtyKg ?? 0);
            decimal? Total(string type) => mine.FirstOrDefault(r => r.RowType == type)?.MonthQtyKg;

            if (Total(GradeAnalysisRowType.MainTotal) is { } mt && Differs(Sum("MAIN"), mt))
                problems.Add($"{e}: main grades add to {Sum("MAIN"):N2} kg but MAIN TOTAL says {mt:N2}");
            if (Total(GradeAnalysisRowType.OffTotal) is { } ot && Differs(Sum("OFF"), ot))
                problems.Add($"{e}: off grades add to {Sum("OFF"):N2} kg but OFF TOTAL says {ot:N2}");
            if (Total(GradeAnalysisRowType.ElevationTotal) is { } et && Differs(Sum("MAIN") + Sum("OFF"), et))
                problems.Add($"{e}: grades add to {Sum("MAIN") + Sum("OFF"):N2} kg but ELEVATION TOTAL says {et:N2}");
        }

        var summaries = p.Rows.Where(r => r.RowType == GradeAnalysisRowType.ElevationSummary).ToList();
        var grand = p.Rows.FirstOrDefault(r => r.RowType == GradeAnalysisRowType.GrandTotal);
        if (summaries.Count > 0 && grand is not null && Differs(summaries.Sum(s => s.MonthQtyKg ?? 0), grand.MonthQtyKg ?? 0))
            problems.Add($"elevations add to {summaries.Sum(s => s.MonthQtyKg ?? 0):N2} kg but GRAND TOTAL says {grand.MonthQtyKg ?? 0:N2}");
        return problems;
    }

    /// <summary>Same text decoding as the factory-averages reports (UTF-16 / UTF-8 / Latin-1).</summary>
    public static string DecodeText(byte[] raw) => FactoryAveragesParser.DecodeText(raw);
}
