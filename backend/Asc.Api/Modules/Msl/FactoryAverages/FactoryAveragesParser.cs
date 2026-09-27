using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Msl.FactoryAverages;

/// <summary>
/// Parser for the monthly "FACTORY WISE AVERAGES FOR &lt;MONTH&gt; &lt;YEAR&gt;" report (Asia Siyaka's
/// FAC03 print-out; data/msl/factory-averages/&lt;year&gt;/factory-averages-YYYY-MM.txt). Verified
/// against every such report from January 2019 to August 2026 (the live archive now starts January 2023 — see data/_archive-pre2023) (89 files, ~59k rows): factories sum
/// to their elevation totals, elevations to the grand total, and weighted averages agree, apart
/// from three internal inconsistencies in the source itself (see <see cref="Reconcile"/>).
///
/// Layout (132 columns, one report per month, an elevation at a time): each factory takes two
/// lines — the name line carries eight right-aligned number columns (main-grade monthly and
/// cumulative kg, off-grade monthly and cumulative kg, total monthly kg + rank, total cumulative
/// kg + rank) and the MF-code line beneath carries the matching average prices (six columns, no
/// ranks). Blank cells mean no sales. An "ELEVATION TOTAL" and finally a "GRAND TOTAL" pair of lines
/// close each elevation and the report.
///
/// Older reports use other layouts (the 2018 PDFs, the December 2018 text file, the March/June/July
/// 2019 PDFs); those return null here and are simply archived, not imported.
/// </summary>
public static partial class FactoryAveragesParser
{
    public record Parsed(int Year, int Month, List<FactoryAverage> Rows);

    // Right edge of each number column: mainM, mainC, offM, offC, totM, rankM, totC, rankC.
    private static readonly int[] Ends = [46, 60, 74, 89, 105, 110, 125, 130];
    private const int NumberAreaStart = 30;   // names never reach past here; numbers never start before
    private const int EdgeTolerance = 4;

    private static readonly string[] MonthNames =
        ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

    [GeneratedRegex(@"FACTORY WISE AVERAGES FOR\s+([A-Z]+)\s+(\d{4})")]
    private static partial Regex TitleRe();

    [GeneratedRegex(@"^[A-Z]{2,3}\d{3,5}$")]
    private static partial Regex CodeRe();

    [GeneratedRegex(@"-?\d[\d,]*(?:\.\d+)?")]
    private static partial Regex NumberRe();

    [GeneratedRegex(@"^\w?ASIA SIYAKA")]
    private static partial Regex CompanyLineRe();

    /// <summary>UTF-16 (with BOM — what the reporting system writes), else UTF-8, else Latin-1.</summary>
    public static string DecodeText(byte[] raw)
    {
        if (raw.Length >= 2 && ((raw[0] == 0xFF && raw[1] == 0xFE) || (raw[0] == 0xFE && raw[1] == 0xFF)))
            return new UnicodeEncoding(bigEndian: raw[0] == 0xFE, byteOrderMark: true).GetString(raw, 2, raw.Length - 2);
        try
        {
            return new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(raw);
        }
        catch (DecoderFallbackException)
        {
            return Encoding.Latin1.GetString(raw);
        }
    }

    /// <summary>Parses one monthly report. Returns null when the text isn't this layout (no
    /// "FACTORY WISE AVERAGES FOR ..." title); throws <see cref="FormatException"/> when it is but a
    /// line doesn't fit — a changed layout should fail loudly, not import wrong numbers.</summary>
    public static Parsed? Parse(string text, string sourceFile)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

        Match? title = null;
        foreach (var l in lines.Take(8))
            if ((title = TitleRe().Match(l)).Success) break;
        if (title is not { Success: true }) return null;
        var monthIdx = Array.IndexOf(MonthNames, title.Groups[1].Value);
        if (monthIdx < 0) return null;
        int year = int.Parse(title.Groups[2].Value, CultureInfo.InvariantCulture), month = monthIdx + 1;

        var rows = new List<FactoryAverage>();
        string? elevation = null;
        (string Kind, string? Name, decimal?[] Qty)? pending = null;

        foreach (var raw in lines)
        {
            var l = raw.TrimEnd();
            if (l.Length == 0 || l.Trim().Length == 0) continue;

            if (l.StartsWith("Elevation :", StringComparison.Ordinal))
            {
                var e = l[(l.IndexOf(':') + 1)..];
                var pg = e.IndexOf("PAGE:", StringComparison.Ordinal);
                elevation = (pg >= 0 ? e[..pg] : e).Trim();
                pending = null;
                continue;
            }
            var trimmed = l.TrimStart();
            if (CompanyLineRe().IsMatch(l) || l.StartsWith("FACTORY WISE", StringComparison.Ordinal) ||
                l.StartsWith("NAME OF ESTATE", StringComparison.Ordinal) || l.StartsWith("---", StringComparison.Ordinal) ||
                trimmed.StartsWith("MONTHLY", StringComparison.Ordinal) || trimmed.StartsWith("* * *", StringComparison.Ordinal) ||
                trimmed.StartsWith("*  *  *", StringComparison.Ordinal))
                continue;

            // The label is everything before the first number column (numbers never start before column 30).
            var firstNumber = NumberRe().Matches(l).FirstOrDefault(m => m.Index >= NumberAreaStart);
            var left = firstNumber is null ? l : l[..firstNumber.Index];
            var compact = left.Replace(" ", "");

            if (compact.StartsWith("ELEVATIONTOTAL", StringComparison.Ordinal) || compact.StartsWith("GRANDTOTAL", StringComparison.Ordinal))
            {
                pending = (compact.StartsWith("ELEVATION", StringComparison.Ordinal) ? FactoryAverageRowType.ElevationTotal : FactoryAverageRowType.GrandTotal,
                    null, Cells(l));
                continue;
            }
            if (compact.Length == 0 && pending is { Kind: not FactoryAverageRowType.Factory } total)
            {
                rows.Add(Build(year, month, total.Kind, total.Kind == FactoryAverageRowType.ElevationTotal ? elevation : null, null, null,
                    total.Qty, Cells(l), sourceFile));
                pending = null;
                continue;
            }
            if (CodeRe().IsMatch(compact) && pending is { Kind: FactoryAverageRowType.Factory } factory)
            {
                rows.Add(Build(year, month, FactoryAverageRowType.Factory, elevation, factory.Name, compact, factory.Qty, Cells(l), sourceFile));
                pending = null;
                continue;
            }
            if (compact.Length > 0 && elevation is not null)
            {
                pending = (FactoryAverageRowType.Factory, left.Trim(), Cells(l));
                continue;
            }
            throw new FormatException($"Unrecognised line in factory averages report: '{l.Trim()}'");
        }
        return new Parsed(year, month, rows);
    }

    /// <summary>The eight number columns of a line (null where blank).</summary>
    private static decimal?[] Cells(string line)
    {
        var cells = new decimal?[Ends.Length];
        foreach (Match m in NumberRe().Matches(line))
        {
            if (m.Index < NumberAreaStart) continue;
            var end = m.Index + m.Length;
            var col = 0;
            for (var i = 1; i < Ends.Length; i++)
                if (Math.Abs(Ends[i] - end) < Math.Abs(Ends[col] - end)) col = i;
            if (Math.Abs(Ends[col] - end) > EdgeTolerance)
                throw new FormatException($"Number '{m.Value}' ends at column {end}, not under a report column: '{line.Trim()}'");
            cells[col] = decimal.Parse(m.Value.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture);
        }
        return cells;
    }

    private static FactoryAverage Build(int year, int month, string kind, string? elevation, string? name, string? code,
        decimal?[] q, decimal?[] a, string sourceFile) => new()
    {
        Year = year,
        Month = month,
        RowType = kind,
        Elevation = elevation,
        FactoryName = name,
        MfCode = code,
        MainMonthlyQtyKg = q[0],
        MainCumulativeQtyKg = q[1],
        OffMonthlyQtyKg = q[2],
        OffCumulativeQtyKg = q[3],
        TotalMonthlyQtyKg = q[4],
        TotalCumulativeQtyKg = q[6],
        MonthlyRank = q[5] is { } rm ? (int)rm : null,
        CumulativeRank = q[7] is { } rc ? (int)rc : null,
        MainMonthlyAvgRs = a[0],
        MainCumulativeAvgRs = a[1],
        OffMonthlyAvgRs = a[2],
        OffCumulativeAvgRs = a[3],
        TotalMonthlyAvgRs = a[4],
        TotalCumulativeAvgRs = a[6],
        SourceFile = sourceFile,
    };

    /// <summary>
    /// Checks a parsed month against its own printed totals: each elevation's factories must add up
    /// to its ELEVATION TOTAL, and the elevation totals to the GRAND TOTAL (monthly quantities).
    /// Returns human-readable discrepancies; empty means the month is internally consistent. A few
    /// source reports are not (e.g. January 2022's Uva High total is 26,420 kg above its listed
    /// factories) — those are logged at import, not rejected.
    /// </summary>
    public static List<string> Reconcile(Parsed p)
    {
        var problems = new List<string>();
        var factories = p.Rows.Where(r => r.RowType == FactoryAverageRowType.Factory).ToList();
        var totals = p.Rows.Where(r => r.RowType == FactoryAverageRowType.ElevationTotal).ToList();
        var grand = p.Rows.FirstOrDefault(r => r.RowType == FactoryAverageRowType.GrandTotal);
        if (grand is null) problems.Add("no grand total");

        static bool Differs(decimal a, decimal b) => Math.Abs(a - b) > Math.Max(1m, Math.Abs(b) * 0.000001m);

        foreach (var t in totals)
        {
            var mine = factories.Where(f => f.Elevation == t.Elevation).ToList();
            if (Differs(mine.Sum(f => f.MainMonthlyQtyKg ?? 0), t.MainMonthlyQtyKg ?? 0))
                problems.Add($"{t.Elevation}: main-grade factories {mine.Sum(f => f.MainMonthlyQtyKg ?? 0):N2} kg vs total {t.MainMonthlyQtyKg ?? 0:N2} kg");
            if (Differs(mine.Sum(f => f.OffMonthlyQtyKg ?? 0), t.OffMonthlyQtyKg ?? 0))
                problems.Add($"{t.Elevation}: off-grade factories {mine.Sum(f => f.OffMonthlyQtyKg ?? 0):N2} kg vs total {t.OffMonthlyQtyKg ?? 0:N2} kg");
        }
        if (grand is not null && Differs(totals.Sum(t => t.TotalMonthlyQtyKg ?? 0), grand.TotalMonthlyQtyKg ?? 0))
            problems.Add($"elevation totals {totals.Sum(t => t.TotalMonthlyQtyKg ?? 0):N2} kg vs grand total {grand.TotalMonthlyQtyKg ?? 0:N2} kg");
        return problems;
    }
}
