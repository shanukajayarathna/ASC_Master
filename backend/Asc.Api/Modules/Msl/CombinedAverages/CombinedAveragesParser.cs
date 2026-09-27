using System.Globalization;
using System.Text.RegularExpressions;
using Asc.Api.Modules.Msl.FactoryAverages;

namespace Asc.Api.Modules.Msl.CombinedAverages;

/// <summary>
/// Parser for the monthly "COLOMBO BROKERS ASSO. GROSS AVERAGES FOR THE MONTH OF &lt;MONTH&gt;,&lt;YEAR&gt;" reports
/// (data/msl/combined-averages/&lt;year&gt;/combined-averages-YYYY-MM.txt). Each page is headed by the broker's
/// name ("... PAGE-- 3"); a factory takes three lines — name with quantity, gross proceeds and combined
/// average, then its code with the unit rate, then "SELLING MARK: ..." — and each broker's block closes with
/// an indented TOTAL and elevation-group lines. The report ends with GRAND TOTALS across brokers.
/// </summary>
public static partial class CombinedAveragesParser
{
    public record Parsed(int Year, int Month, List<CombinedAverageRow> Rows);

    private static readonly string[] MonthAbbr = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    [GeneratedRegex(@"GROSS AVERAGES\s+FOR THE MONTH\s*OF\s+([A-Z]+)[\s,.\-]*(\d{2,4})", RegexOptions.IgnoreCase)]
    private static partial Regex TitleRe();

    [GeneratedRegex(@"^(.+?)\s+PAGE--\s*\d+\s*$")]
    private static partial Regex BrokerRe();

    // name, then quantity, gross proceeds, combined average (comma-grouped or not; ".00" with no integer part occurs)
    [GeneratedRegex(@"^(\S.*?)\s{2,}([\d,]*\.?\d+)\s+([\d,]*\.?\d+)\s+([\d,]*\.\d+)\s*$")]
    private static partial Regex FactoryRe();

    [GeneratedRegex(@"^([A-Z]{1,3}\d{3,5})\s+UNIT RATE\s+([\d.]+)\s*$")]
    private static partial Regex CodeRe();

    [GeneratedRegex(@"^\s+SELLING MARK:\s*(.*?)\s*$")]
    private static partial Regex MarkRe();

    // indented total lines: TOTAL / GRAND TOTALS / HIGH - UVA / MEDIUM - WESTERN / LOW ...
    [GeneratedRegex(@"^\s{3,}(TOTAL|GRAND TOTALS|(?:HIGH|MEDIUM)\s*-\s*[A-Z]+|LOW)\s+([\d,]*\.?\d+)\s+([\d,]*\.?\d+)\s+([\d,]*\.\d+)\s*$")]
    private static partial Regex TotalRe();

    /// <summary>Returns null when the text isn't a gross-averages report; throws <see cref="FormatException"/>
    /// when it is but a line doesn't fit.</summary>
    public static Parsed? Parse(string text, string sourceFile)
    {
        var lines = text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var title = lines.Take(6).Select(l => TitleRe().Match(l)).FirstOrDefault(m => m.Success);
        if (title is null) return null;
        var monthIdx = Array.IndexOf(MonthAbbr, title.Groups[1].Value.ToUpperInvariant()[..Math.Min(3, title.Groups[1].Value.Length)]);
        if (monthIdx < 0) return null;
        var y = int.Parse(title.Groups[2].Value, CultureInfo.InvariantCulture);
        int year = y < 100 ? 2000 + y : y, month = monthIdx + 1;

        var rows = new List<CombinedAverageRow>();
        string? broker = null;
        var grand = false;
        (string Name, decimal? Qty, decimal? Proceeds, decimal? Avg)? factory = null;
        (string Code, decimal? Unit)? code = null;

        foreach (var raw in lines)
        {
            var l = raw.TrimEnd();
            if (l.All(c => char.IsWhiteSpace(c) || char.IsControl(c))) continue;
            var t = l.Trim();

            if (TitleRe().IsMatch(l) || Regex.IsMatch(t, @"^[*\s]+$") || t.StartsWith("F A C T O R Y", StringComparison.Ordinal) ||
                t.StartsWith("M F C O D E", StringComparison.Ordinal) || t.StartsWith("BROKER", StringComparison.OrdinalIgnoreCase))
                continue;

            if (BrokerRe().Match(l) is { Success: true } bm && !l.StartsWith(' '))
            {
                if (!grand) broker = Regex.Replace(bm.Groups[1].Value.Trim(), @"\s+", " ");
                // The report's last page repeats a broker header above the grand totals; that block starts at GRAND TOTALS.
                factory = null; code = null;
                continue;
            }

            if (TotalRe().Match(l) is { Success: true } tm)
            {
                var label = Regex.Replace(tm.Groups[1].Value, @"\s+", " ").Replace(" -", " -").Trim().ToUpperInvariant();
                if (label == "GRAND TOTALS") grand = true;
                var rowType = label switch
                {
                    "GRAND TOTALS" => CombinedAverageRowType.GrandTotal,
                    "TOTAL" => CombinedAverageRowType.BrokerTotal,
                    _ => grand ? CombinedAverageRowType.GrandElevation : CombinedAverageRowType.BrokerElevation,
                };
                rows.Add(new CombinedAverageRow
                {
                    Year = year, Month = month, Broker = grand ? null : broker, RowType = rowType,
                    Elevation = rowType is CombinedAverageRowType.GrandTotal or CombinedAverageRowType.BrokerTotal ? null : Regex.Replace(label, @"\s*-\s*", " - "),
                    QuantityKg = Num(tm.Groups[2].Value), GrossProceedsRs = Num(tm.Groups[3].Value), AvgRs = Num(tm.Groups[4].Value),
                    SourceFile = sourceFile,
                });
                continue;
            }

            if (CodeRe().Match(l) is { Success: true } cm && factory is not null)
            {
                code = (cm.Groups[1].Value, Num(cm.Groups[2].Value));
                continue;
            }
            if (MarkRe().Match(l) is { Success: true } mm && factory is { } f && code is { } c)
            {
                rows.Add(new CombinedAverageRow
                {
                    Year = year, Month = month, Broker = broker, RowType = CombinedAverageRowType.Factory,
                    Factory = f.Name, MfCode = c.Code, SellingMark = mm.Groups[1].Value.Length == 0 ? null : mm.Groups[1].Value,
                    QuantityKg = f.Qty, GrossProceedsRs = f.Proceeds, AvgRs = f.Avg, UnitRate = c.Unit, SourceFile = sourceFile,
                });
                factory = null; code = null;
                continue;
            }
            if (FactoryRe().Match(l) is { Success: true } fm && !l.StartsWith(' '))
            {
                if (broker is null) throw new FormatException($"Factory line before any broker heading: '{t}'");
                factory = (fm.Groups[1].Value.Trim(), Num(fm.Groups[2].Value), Num(fm.Groups[3].Value), Num(fm.Groups[4].Value));
                code = null;
                continue;
            }
            throw new FormatException($"Unrecognised line in combined averages report: '{t}'");
        }
        return new Parsed(year, month, rows);
    }

    private static decimal? Num(string s) =>
        decimal.TryParse(s.Replace(",", ""), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;

    /// <summary>Checks a parsed month: each broker's factories must add up to its TOTAL (quantity and proceeds),
    /// its elevation lines to the same TOTAL, and the brokers' totals to the GRAND TOTAL. Empty means consistent.</summary>
    public static List<string> Reconcile(Parsed p)
    {
        var problems = new List<string>();
        static bool Differs(decimal a, decimal b, decimal relative = 0.000001m) => Math.Abs(a - b) > Math.Max(1m, Math.Abs(b) * relative);

        foreach (var broker in p.Rows.Where(r => r.Broker is not null).Select(r => r.Broker!).Distinct())
        {
            var mine = p.Rows.Where(r => r.Broker == broker).ToList();
            var total = mine.FirstOrDefault(r => r.RowType == CombinedAverageRowType.BrokerTotal);
            if (total is null) { problems.Add($"{broker}: no TOTAL line"); continue; }
            var fq = mine.Where(r => r.RowType == CombinedAverageRowType.Factory).Sum(r => r.QuantityKg ?? 0);
            var fp = mine.Where(r => r.RowType == CombinedAverageRowType.Factory).Sum(r => r.GrossProceedsRs ?? 0);
            if (Differs(fq, total.QuantityKg ?? 0)) problems.Add($"{broker}: factories add to {fq:N2} kg but TOTAL says {total.QuantityKg ?? 0:N2}");
            if (Differs(fp, total.GrossProceedsRs ?? 0, 0.00001m)) problems.Add($"{broker}: factories add to Rs {fp:N2} but TOTAL says Rs {total.GrossProceedsRs ?? 0:N2}");
            var eq = mine.Where(r => r.RowType == CombinedAverageRowType.BrokerElevation).Sum(r => r.QuantityKg ?? 0);
            if (eq > 0 && Differs(eq, total.QuantityKg ?? 0)) problems.Add($"{broker}: elevation lines add to {eq:N2} kg but TOTAL says {total.QuantityKg ?? 0:N2}");
        }

        var grand = p.Rows.FirstOrDefault(r => r.RowType == CombinedAverageRowType.GrandTotal);
        var bt = p.Rows.Where(r => r.RowType == CombinedAverageRowType.BrokerTotal).Sum(r => r.QuantityKg ?? 0);
        if (grand is not null && Differs(bt, grand.QuantityKg ?? 0)) problems.Add($"broker totals add to {bt:N2} kg but GRAND TOTALS says {grand.QuantityKg ?? 0:N2}");
        return problems;
    }

    public static string DecodeText(byte[] raw) => FactoryAveragesParser.DecodeText(raw);
}
