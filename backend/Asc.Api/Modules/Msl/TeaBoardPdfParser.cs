using System.Globalization;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Parses the Sri Lanka Tea Board monthly national averages PDFs (data/msl/tea-board/
/// national-averages-YYYY-MM.pdf). Both naming eras of the report (2018's "NATIONAL
/// ELEVATIONAL AVERAGES" and 2024+'s "NATIONAL AVERAGES REPORT") share the same table:
/// sections by manufacture type, each with elevation rows carrying month + year-to-date
/// quantity and average. Year/month come from the normalized file name — authoritative
/// here, since the archive organizer already dated every file (reading the scanned ones
/// visually where needed).
///
/// The table is read geometrically, not as flowed text: PdfPig's word order comes out
/// column-scrambled on the newer layout (the June 2026 report's Orthodox/LOW row picked up
/// the section total), so instead the four column headers are located, words are clustered
/// into rows by their vertical position, and each number is assigned to the column whose
/// header it sits under. Files without that header block — scanned images with no text
/// layer, and the circular-letter versions of the report — yield no rows.
/// </summary>
public static class TeaBoardPdfParser
{
    // "~2" marks the second copy of a month (a different document type for the same month,
    // or the only text-bearing copy when the base file is a scan) — see MslImportService.
    private static readonly Regex FileNameRe = new(@"national-averages-(\d{4})-(\d{2})(~\d+)?\.pdf$", RegexOptions.IgnoreCase);

    /// <summary>True for a "~N" alternate copy of a month (national-averages-2019-01~2.pdf).</summary>
    public static bool IsAlternateCopy(string fileName) => FileNameRe.Match(fileName) is { Success: true } m && m.Groups[3].Success;

    /// <summary>Year/month encoded in a tea-board file name, or null when it doesn't follow the convention.</summary>
    public static (int Year, int Month)? PeriodOf(string fileName) =>
        FileNameRe.Match(fileName) is { Success: true } m ? (int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value)) : null;

    // Section headers as they appear in either era of the report. Only label lines that carry
    // no numbers are tested, so an elevation row can never be mistaken for a header.
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

    // Digits, thousands commas and a decimal point — also bare fragments like ",028,464", which
    // the older PDFs' text layer produces when it splits one figure across several words.
    private static readonly Regex NumberCell = new(@"^[\d,.]*\d[\d,.]*$", RegexOptions.Compiled);

    private const double RowTolerance = 4;      // words within this many points share a line
    private const double FragmentGap = 3;      // numeric words closer than this are pieces of one figure
    private const double NumberToLabelMax = 9;  // a number this far from its label line is orphaned

    public static List<TeaBoardAverage> ParseFile(string path, string relativePath)
    {
        var m = FileNameRe.Match(Path.GetFileName(path));
        if (!m.Success) return [];
        int year = int.Parse(m.Groups[1].Value), month = int.Parse(m.Groups[2].Value);

        var rows = new List<TeaBoardAverage>();
        using var pdf = PdfDocument.Open(path);
        var current = "ORTHODOX"; // the first block of every report has no header of its own
        foreach (var page in pdf.GetPages())
            ParsePage(page.GetWords().ToList(), ref current, year, month, relativePath, rows);
        return rows;
    }

    private record LabelLine(double Y, List<Word> Words);

    private static double CentreX(Word w) => (w.BoundingBox.Left + w.BoundingBox.Right) / 2;
    private static double CentreY(Word w) => (w.BoundingBox.Top + w.BoundingBox.Bottom) / 2;

    private static void ParsePage(List<Word> words, ref string section, int year, int month, string sourceFile, List<TeaBoardAverage> rows)
    {
        if (words.Count == 0) return;

        // ---- header: only pages carrying the two QUANTITY column headers hold the table ----
        var quantity = words.Where(w => w.Text.Equals("QUANTITY", StringComparison.OrdinalIgnoreCase)).ToList();
        if (quantity.Count < 2) return; // scan / circular letter / no table on this page
        var headerY = quantity.Max(w => CentreY(w));
        // ---- body: everything below the header line ----
        // A lone "-" is an empty cell only when it sits in the number area (right of the label
        // column); the label column ends where the QUANTITY header begins.
        var dashColumnsLeft = quantity.Min(w => w.BoundingBox.Left) - 40;
        var body = words.Where(w => CentreY(w) < headerY - RowTolerance).ToList();
        bool IsNumber(Word w) => NumberCell.IsMatch(w.Text) || (w.Text == "-" && CentreX(w) >= dashColumnsLeft);

        var labelLines = new List<LabelLine>();
        foreach (var w in body.Where(w => !IsNumber(w)).OrderByDescending(w => CentreY(w)))
        {
            var y = CentreY(w);
            var line = labelLines.FirstOrDefault(l => Math.Abs(l.Y - y) <= RowTolerance);
            if (line is null) labelLines.Add(new LabelLine(y, [w]));
            else line.Words.Add(w);
        }

        // Each number joins the nearest label line. The older PDFs sometimes split one figure into
        // fragments ("2" + "7,440,571"), so a line's numeric words are re-joined left-to-right
        // wherever they physically touch; each resulting figure then goes to the column whose
        // header extent it sits under.
        var numbersByLine = new Dictionary<int, List<Word>>();
        foreach (var w in body.Where(IsNumber))
        {
            var best = -1;
            var bestDist = NumberToLabelMax;
            for (var i = 0; i < labelLines.Count; i++)
            {
                var d = Math.Abs(labelLines[i].Y - CentreY(w));
                if (d < bestDist) { bestDist = d; best = i; }
            }
            if (best < 0) continue;
            if (!numbersByLine.TryGetValue(best, out var list)) numbersByLine[best] = list = [];
            list.Add(w);
        }

        var figures = new List<(int Line, decimal? Value, double Right)>();
        foreach (var (line, list) in numbersByLine)
        {
            var figure = new List<Word>();
            void Emit()
            {
                if (figure.Count == 0) return;
                var text = string.Concat(figure.Select(w => w.Text));
                if (text != "-") figures.Add((line, Num(text), figure.Max(w => w.BoundingBox.Right)));
                figure.Clear();
            }
            foreach (var w in list.OrderBy(w => w.BoundingBox.Left))
            {
                if (figure.Count > 0 && w.BoundingBox.Left - figure[^1].BoundingBox.Right > FragmentGap) Emit();
                figure.Add(w);
            }
            Emit();
        }

        // The four data columns are right-aligned, so their figures' right edges bunch tightly with
        // wide gaps between columns — split at the three widest gaps. (Header text can't be trusted
        // for this: in some issues it sits well left of the numbers.)
        var edges = figures.Select(f => f.Right).OrderBy(x => x).ToList();
        if (edges.Count < 4) return;
        var cuts = Enumerable.Range(1, edges.Count - 1)
            .OrderByDescending(i => edges[i] - edges[i - 1]).Take(3)
            .Select(i => (edges[i] + edges[i - 1]) / 2).OrderBy(x => x).ToList();
        var cells = labelLines.Select(_ => new decimal?[4]).ToList();
        foreach (var f in figures)
        {
            var col = cuts.Count(c => f.Right > c);
            cells[f.Line][col] ??= f.Value;
        }

        for (var i = 0; i < labelLines.Count; i++)
        {
            var text = string.Join(" ", labelLines[i].Words.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text)).Trim();
            if (text.Length == 0) continue;

            // An elevation name makes it a data row (even when every cell is "-"); anything else
            // is a section header, whatever stray dashes sit in its number columns.
            var elevation = RowNames.FirstOrDefault(r => r.Re.IsMatch(text)).Elevation;
            if (elevation is null)
            {
                if (text.Length >= 80) continue; // footnote / prose, not a header
                foreach (var (re, name) in Sections)
                    if (re.IsMatch(text)) { section = name; break; }
                continue;
            }
            rows.Add(new TeaBoardAverage
            {
                Year = year,
                Month = month,
                Section = section,
                Elevation = elevation,
                MonthQtyKg = cells[i][0],
                MonthAvgRs = cells[i][1],
                TodateQtyKg = cells[i][2],
                TodateAvgRs = cells[i][3],
                SourceFile = sourceFile,
            });
        }
    }

    private static decimal? Num(string cell) =>
        decimal.TryParse(cell.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : null;
}
