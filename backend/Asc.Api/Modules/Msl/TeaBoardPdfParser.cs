using System.Globalization;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Parses the Sri Lanka Tea Board monthly national averages PDFs (data/msl/tea-board/
/// national-averages-YYYY-MM.pdf). Both naming eras of the report (2018's "NATIONAL
/// ELEVATIONAL AVERAGES" and 2024+'s "NATIONAL AVERAGES REPORT") share the same table:
/// sections by manufacture type, each with elevation rows carrying month + year-to-date
/// quantity and average. Year/month come from the normalized file name — authoritative
/// here, since the archive organizer already dated every file (reading the scanned ones
/// visually where needed).
/// </summary>
public static class TeaBoardPdfParser
{
    private static readonly Regex FileNameRe = new(@"national-averages-(\d{4})-(\d{2})\.pdf$", RegexOptions.IgnoreCase);

    // Section headers as they appear in either era of the report.
    private static readonly (Regex Re, string Section)[] Sections =
    [
        (new Regex(@"ORTH\.?\s*&\s*CTC|OTH/CTC|COMBINED", RegexOptions.IgnoreCase), "COMBINED"),
        (new Regex(@"\bORTHODOX\b", RegexOptions.IgnoreCase), "ORTHODOX"),
        (new Regex(@"\bCTC\b", RegexOptions.IgnoreCase), "CTC"),
        (new Regex(@"GREEN", RegexOptions.IgnoreCase), "GREEN"),
        (new Regex(@"ORGANIC", RegexOptions.IgnoreCase), "ORGANIC"),
        (new Regex(@"SPECIAL", RegexOptions.IgnoreCase), "SPECIAL"),
        (new Regex(@"REFUSE|BLACK TEA", RegexOptions.IgnoreCase), "REFUSE"),
        (new Regex(@"COMPOSITE", RegexOptions.IgnoreCase), "COMPOSITE"),
    ];

    private static readonly (Regex Re, string Elevation)[] RowNames =
    [
        (new Regex(@"^UVA[\s-]*HIGH", RegexOptions.IgnoreCase), "UVA HIGH"),
        (new Regex(@"^WESTERN[\s-]*HIGH", RegexOptions.IgnoreCase), "WESTERN HIGH"),
        (new Regex(@"^UVA[\s-]*MEDIUM", RegexOptions.IgnoreCase), "UVA MEDIUM"),
        (new Regex(@"^WESTERN[\s-]*MEDIUM", RegexOptions.IgnoreCase), "WESTERN MEDIUM"),
        (new Regex(@"^LOW(\s*GROWN)?\b", RegexOptions.IgnoreCase), "LOW"),
        (new Regex(@"^HIGH\s*GROWN", RegexOptions.IgnoreCase), "HIGH GROWN"),
        (new Regex(@"^MEDIUM\s*GROWN", RegexOptions.IgnoreCase), "MEDIUM GROWN"),
        (new Regex(@"^ALL\s*TEA", RegexOptions.IgnoreCase), "ALL TEA"),
        (new Regex(@"^OTHERS?\b", RegexOptions.IgnoreCase), "OTHER"),
        (new Regex(@"^TOTAL\b", RegexOptions.IgnoreCase), "TOTAL"),
    ];

    // Four numeric cells: month qty, month avg, todate qty, todate avg. "-" or missing
    // cells appear in months where a category had no sales.
    private static readonly Regex Numbers = new(@"([\d,]+(?:\.\d+)?|-)\s+([\d,]+(?:\.\d+)?|-)\s+([\d,]+(?:\.\d+)?|-)\s+([\d,]+(?:\.\d+)?|-)");

    public static List<TeaBoardAverage> ParseFile(string path, string relativePath)
    {
        var m = FileNameRe.Match(Path.GetFileName(path));
        if (!m.Success) return [];
        int year = int.Parse(m.Groups[1].Value), month = int.Parse(m.Groups[2].Value);

        var rows = new List<TeaBoardAverage>();
        using var pdf = PdfDocument.Open(path);
        foreach (var page in pdf.GetPages())
        {
            // Join words in content order — page.Text can run cells together without spaces.
            var text = string.Join(" ", page.GetWords().Select(w => w.Text));
            // Re-split into virtual lines at each known row/section name so one flowed page
            // parses like the visual table.
            var current = "ORTHODOX";
            foreach (var chunk in SplitAtNames(text))
            {
                foreach (var (re, section) in Sections)
                {
                    if (re.IsMatch(chunk) && chunk.Length < 80) { current = section; break; }
                }
                foreach (var (re, elevation) in RowNames)
                {
                    if (!re.IsMatch(chunk)) continue;
                    var nm = Numbers.Match(chunk);
                    if (!nm.Success) break;
                    rows.Add(new TeaBoardAverage
                    {
                        Year = year,
                        Month = month,
                        Section = current,
                        Elevation = elevation,
                        MonthQtyKg = Num(nm.Groups[1].Value),
                        MonthAvgRs = Num(nm.Groups[2].Value),
                        TodateQtyKg = Num(nm.Groups[3].Value),
                        TodateAvgRs = Num(nm.Groups[4].Value),
                        SourceFile = relativePath,
                    });
                    break;
                }
            }
        }
        return rows;
    }

    /// <summary>Splits flowed page text into chunks starting at each elevation/section
    /// name, so each chunk holds one visual row (name + its four numbers) or one header.</summary>
    private static IEnumerable<string> SplitAtNames(string text)
    {
        var starts = new List<int>();
        foreach (Match m in Regex.Matches(text,
            @"UVA[\s-]*HIGH|WESTERN[\s-]*HIGH|UVA[\s-]*MEDIUM|WESTERN[\s-]*MEDIUM|LOW\s*GROWN|\bLOW\b|HIGH\s*GROWN|MEDIUM\s*GROWN|ALL\s*TEA|\bOTHERS?\b|\bTOTAL\b|ORTHODOX|\bCTC\b|OTH/CTC|ORTH\.?\s*&\s*CTC|COMBINED|GREEN|ORGANIC|SPECIAL|REFUSE|BLACK TEA|COMPOSITE",
            RegexOptions.IgnoreCase))
            starts.Add(m.Index);
        for (int i = 0; i < starts.Count; i++)
        {
            var end = i + 1 < starts.Count ? starts[i + 1] : text.Length;
            yield return text[starts[i]..end].Trim();
        }
    }

    private static decimal? Num(string cell)
    {
        cell = cell.Trim();
        if (cell.Length == 0 || cell == "-") return null;
        return decimal.TryParse(cell.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : null;
    }
}
