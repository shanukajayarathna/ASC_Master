using Asc.Api.Modules.Msl;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Writer;

namespace Asc.Api.Tests;

public class TeaBoardPdfParserTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"asc-tb-{Guid.NewGuid():N}");

    public TeaBoardPdfParserTests() => Directory.CreateDirectory(_dir);
    public void Dispose() => Directory.Delete(_dir, recursive: true);

    // Right edges of the four number columns; the headers deliberately sit far to the left of the
    // numbers (as in the Feb 2020 issue), so column assignment must not rely on header extents.
    private static readonly double[] ColRight = [300, 380, 460, 540];

    private string Build(string name, Action<PdfPageBuilder, PdfDocumentBuilder.AddedFont> draw)
    {
        var b = new PdfDocumentBuilder();
        var font = b.AddStandard14Font(UglyToad.PdfPig.Fonts.Standard14Fonts.Standard14Font.Helvetica);
        draw(b.AddPage(595, 842), font);
        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, b.Build());
        return path;
    }

    private static void Header(PdfPageBuilder p, PdfDocumentBuilder.AddedFont f)
    {
        p.AddText("NATIONAL AVERAGES REPORT - June 2026", 10, new PdfPoint(200, 800), f);
        foreach (var x in new[] { 150.0, 240, 330, 420 })
        {
            p.AddText("QUANTITY", 8, new PdfPoint(x, 770), f);
            p.AddText("- KG", 8, new PdfPoint(x + 45, 770), f);
        }
    }

    /// <summary>One table row: label on the label baseline, numbers right-aligned to the columns
    /// on a baseline 1.5pt lower (as real reports have them).</summary>
    private static void Row(PdfPageBuilder p, PdfDocumentBuilder.AddedFont f, double y, string label, params string[] cells)
    {
        p.AddText(label, 8, new PdfPoint(40, y), f);
        for (var i = 0; i < cells.Length; i++)
        {
            var w = cells[i].Length * 4.5; // Helvetica 8pt digit ≈ 4.45pt
            p.AddText(cells[i], 8, new PdfPoint(ColRight[i] - w, y - 1.5), f);
        }
    }

    [Fact]
    public void ParseFile_ReadsRowsByPosition_NotByTextOrder()
    {
        var path = Build("national-averages-2026-06.pdf", (p, f) =>
        {
            Header(p, f);
            Row(p, f, 740, "Orthodox");
            Row(p, f, 720, "UVA-HIGH", "1,413,091", "978.08", "7,280,374", "1,037.46");
            Row(p, f, 700, "WESTERN-HIGH", "2,617,260", "1,140.05", "15,310,521", "1,209.31");
            Row(p, f, 680, "Total", "4,030,351", "1,079.90", "22,590,895", "1,142.60");
            Row(p, f, 650, "CTC");
            Row(p, f, 630, "UVA-HIGH", "-", "-", "-", "-");
            Row(p, f, 610, "LOW", "906,176", "903.49", "5,520,118", "934.43");
            Row(p, f, 580, "OTH/CTC", "-"); // a stray dash in a header row must not turn it into data
            Row(p, f, 560, "LOW", "12,414,362", "1,272.17", "73,127,846", "1,237.26");
        });

        var rows = TeaBoardPdfParser.ParseFile(path, "tea-board/national-averages-2026-06.pdf");

        Assert.Equal(6, rows.Count);
        var uvaHigh = rows.Single(r => r is { Section: "ORTHODOX", Elevation: "UVA HIGH" });
        Assert.Equal((2026, 6), (uvaHigh.Year, uvaHigh.Month));
        Assert.Equal(1_413_091m, uvaHigh.MonthQtyKg);
        Assert.Equal(978.08m, uvaHigh.MonthAvgRs);
        Assert.Equal(7_280_374m, uvaHigh.TodateQtyKg);
        Assert.Equal(1_037.46m, uvaHigh.TodateAvgRs);
        Assert.Equal(15_310_521m, rows.Single(r => r is { Section: "ORTHODOX", Elevation: "WESTERN HIGH" }).TodateQtyKg);
        Assert.Equal(4_030_351m, rows.Single(r => r is { Section: "ORTHODOX", Elevation: "TOTAL" }).MonthQtyKg);

        // "-" cells are empty, not zero and not dropped rows.
        var empty = rows.Single(r => r is { Section: "CTC", Elevation: "UVA HIGH" });
        Assert.Null(empty.MonthQtyKg);
        Assert.Null(empty.TodateAvgRs);
        Assert.Equal(903.49m, rows.Single(r => r is { Section: "CTC", Elevation: "LOW" }).MonthAvgRs);

        // OTH/CTC is the combined section even though its line carried a dash.
        Assert.Equal(12_414_362m, rows.Single(r => r is { Section: "COMBINED", Elevation: "LOW" }).MonthQtyKg);
    }

    [Fact]
    public void ParseFile_PageWithoutColumnHeaders_YieldsNothing()
    {
        var path = Build("national-averages-2026-06.pdf", (p, f) =>
        {
            p.AddText("Ref.No:TC/EA/2020 - circular letter", 10, new PdfPoint(40, 800), f);
            Row(p, f, 740, "UVA-HIGH", "1,413,091", "978.08", "7,280,374", "1,037.46");
        });
        Assert.Empty(TeaBoardPdfParser.ParseFile(path, "x"));
    }

    [Theory]
    [InlineData("national-averages-2019-01.pdf", 2019, 1, false)]
    [InlineData("national-averages-2019-01~2.pdf", 2019, 1, true)]
    public void FileNameHelpers_RecogniseAlternateCopies(string name, int year, int month, bool alternate)
    {
        Assert.Equal((year, month), TeaBoardPdfParser.PeriodOf(name));
        Assert.Equal(alternate, TeaBoardPdfParser.IsAlternateCopy(name));
    }

    [Fact]
    public void PeriodOf_IgnoresUnconventionalNames() =>
        Assert.Null(TeaBoardPdfParser.PeriodOf("TEA BOARD AVR JAN TODATE2019.pdf"));
}
