using Asc.Api.Modules.Reports;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using A = DocumentFormat.OpenXml.Drawing;

namespace Asc.Api.Tests;

public class CustomDeckGeneratorTests
{
    private static DeckReportDto Brokers(string visual = "bar") => new(
        "Average price (Rs/kg) by broker", "all brokers · the last 12 sales", "Rs/kg", "Broker", visual,
        ["ASC", "FW", "BC"], [new DeckSeriesDto("Average price (Rs/kg)", [1200m, 1100.5m, null])]);

    private static DeckReportDto Trend() => new(
        "Quantity by grade per sale", "BOPF, BOP · sales 36–39", "kg", "Sale", "line",
        ["36/2026", "37/2026", "38/2026", "39/2026"],
        [new DeckSeriesDto("BOPF", [100m, 120m, 90m, 140m]), new DeckSeriesDto("BOP", [80m, 70m, 95m, 60m])]);

    private static CustomDeckRequest Deck(string? template = null, int? max = null, params DeckReportDto[] reports) =>
        new("Weekly broker review", template, max, reports.Length > 0 ? [.. reports] : [Brokers()]);

    private static List<string> SchemaErrors(byte[] bytes)
    {
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        return new OpenXmlValidator().Validate(doc).Select(e => $"{e.Description} @ {e.Path?.XPath}").ToList();
    }

    // ---- validation --------------------------------------------------------------

    [Fact]
    public void Validate_AcceptsAGoodRequest() => Assert.Null(CustomDeckGenerator.Validate(Deck()));

    [Theory]
    [InlineData("", "title")]
    [InlineData("neon", "template")]
    public void Validate_RejectsBadTitleOrTemplate(string value, string what)
    {
        var req = what == "title" ? Deck() with { Title = value } : Deck(template: value);
        Assert.NotNull(CustomDeckGenerator.Validate(req));
    }

    [Fact]
    public void Validate_RejectsMalformedDatasets()
    {
        Assert.NotNull(CustomDeckGenerator.Validate(Deck() with { Reports = [] }));
        Assert.NotNull(CustomDeckGenerator.Validate(Deck() with { Reports = [.. Enumerable.Repeat(Brokers(), CustomDeckGenerator.MaxReports + 1)] }));
        // a series with the wrong number of values would misalign every bar
        Assert.NotNull(CustomDeckGenerator.Validate(Deck(reports: Brokers() with { Series = [new DeckSeriesDto("x", [1m])] })));
        Assert.NotNull(CustomDeckGenerator.Validate(Deck(reports: Brokers() with { Categories = [] })));
        Assert.NotNull(CustomDeckGenerator.Validate(Deck(reports: Brokers() with { Visual = "pie3d" })));
        Assert.Throws<ArgumentException>(() => CustomDeckGenerator.Build(Deck() with { Title = " " }));
    }

    // ---- planning ----------------------------------------------------------------

    [Fact]
    public void Plan_IsTitleThenChartAndTablePerReport_CappedAtTwelve()
    {
        var one = CustomDeckGenerator.Plan(Deck());
        Assert.Equal([DeckSlideKind.Title, DeckSlideKind.Chart, DeckSlideKind.Table], one.Select(s => s.Kind));

        var five = Deck(reports: [.. Enumerable.Repeat(Brokers(), 5)]);
        Assert.Equal(11, CustomDeckGenerator.AvailableSlides(five)); // 1 + 5 x 2, under the cap
        Assert.Equal(4, CustomDeckGenerator.Plan(five with { MaxSlides = 4 }).Count);
        Assert.Equal(2, CustomDeckGenerator.Plan(five with { MaxSlides = 0 }).Count); // never fewer than two
        Assert.Equal(11, CustomDeckGenerator.Plan(five with { MaxSlides = 99 }).Count); // never more than the plan / 12
    }

    [Fact]
    public void Plan_ATableReportHasNoChartSlide()
    {
        var plan = CustomDeckGenerator.Plan(Deck(reports: Brokers("table")));
        Assert.Equal([DeckSlideKind.Title, DeckSlideKind.Table], plan.Select(s => s.Kind));
    }

    // ---- the file ----------------------------------------------------------------

    [Theory]
    [InlineData("ivory")]
    [InlineData("ink")]
    public void Build_ProducesASchemaValidPresentation(string template)
    {
        var bytes = CustomDeckGenerator.Build(Deck(template, null, Brokers(), Trend(), Brokers("table")));

        Assert.True(bytes.Length > 5000);
        Assert.Empty(SchemaErrors(bytes));
    }

    [Fact]
    public void Build_HasOneSlidePerPlanEntryWithNativeChartsAndWorkbooks()
    {
        var bytes = CustomDeckGenerator.Build(Deck(null, null, Brokers(), Trend()));
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        var slides = doc.PresentationPart!.SlideParts.ToList();

        Assert.Equal(5, slides.Count); // title, chart, table, chart, table
        var charts = slides.SelectMany(s => s.ChartParts).ToList();
        Assert.Equal(2, charts.Count);
        Assert.All(charts, c => Assert.Single(c.Parts.Where(p => p.OpenXmlPart is EmbeddedPackagePart))); // "Edit Data" works
    }

    [Fact]
    public void Build_ChartCarriesExactlyTheSuppliedNumbers()
    {
        var bytes = CustomDeckGenerator.Build(Deck(reports: Brokers()));
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        var chart = doc.PresentationPart!.SlideParts.SelectMany(s => s.ChartParts).Single().ChartSpace!;

        var cats = chart.Descendants<C.CategoryAxisData>().Single().Descendants<C.NumericValue>().Select(v => v.Text).ToList();
        var vals = chart.Descendants<C.Values>().Single().Descendants<C.NumericPoint>().Select(p => (p.Index!.Value, p.NumericValue!.Text)).ToList();

        Assert.Equal(["ASC", "FW", "BC"], cats);
        Assert.Equal([(0u, "1200"), (1u, "1100.5")], vals); // the missing value stays a gap, not a zero
        Assert.Single(chart.Descendants<C.BarChart>());
    }

    [Fact]
    public void Build_BrokersKeepTheirOwnColoursOnASingleSeries()
    {
        var bytes = CustomDeckGenerator.Build(Deck(reports: Brokers()));
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        var chart = doc.PresentationPart!.SlideParts.SelectMany(s => s.ChartParts).Single().ChartSpace!;

        var colours = chart.Descendants<C.DataPoint>().Select(d => d.Descendants<A.RgbColorModelHex>().First().Val!.Value).ToList();
        Assert.Equal(["17A2B8", "2E86DE", "6F42C1"], colours); // ASC, FW, BC
    }

    [Fact]
    public void Build_LineVisualUsesALineChartWithOneSeriesPerColumn()
    {
        var bytes = CustomDeckGenerator.Build(Deck(reports: Trend()));
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        var chart = doc.PresentationPart!.SlideParts.SelectMany(s => s.ChartParts).Single().ChartSpace!;

        Assert.Single(chart.Descendants<C.LineChart>());
        Assert.Equal(2, chart.Descendants<C.LineChartSeries>().Count());
        Assert.Single(chart.Descendants<C.Legend>());
    }

    [Fact]
    public void Build_TableSlideShowsEveryFigureFormatted()
    {
        var bytes = CustomDeckGenerator.Build(Deck(reports: Brokers()));
        using var ms = new MemoryStream(bytes);
        using var doc = PresentationDocument.Open(ms, false);
        var table = doc.PresentationPart!.SlideParts.SelectMany(s => s.Slide!.Descendants<A.Table>()).Single();
        var rows = table.Elements<A.TableRow>().Select(r => r.Elements<A.TableCell>().Select(c => c.InnerText).ToList()).ToList();

        Assert.Equal(["Broker", "Average price (Rs/kg)"], rows[0]);
        Assert.Equal(["ASC", "1,200"], rows[1]);
        Assert.Equal(["FW", "1,100.5"], rows[2]);
        Assert.Equal(["BC", "—"], rows[3]);
    }

    [Fact]
    public void Build_TemplatesDifferInBackground()
    {
        string Bg(string template)
        {
            using var ms = new MemoryStream(CustomDeckGenerator.Build(Deck(template)));
            using var doc = PresentationDocument.Open(ms, false);
            return doc.PresentationPart!.SlideParts.First().Slide!.Descendants<A.RgbColorModelHex>().First().Val!.Value!;
        }

        Assert.Equal("F6F3EA", Bg("ivory"));
        Assert.Equal("1B2A22", Bg("ink"));
        Assert.Equal("F6F3EA", Bg(null!)); // Ivory is the default
    }

    [Fact]
    public void FileName_IsSafe()
    {
        Assert.Equal("Weekly broker review.pptx", CustomDeckGenerator.FileName(Deck()));
        Assert.Equal("report-deck.pptx", CustomDeckGenerator.FileName(Deck() with { Title = "???" }));
        Assert.DoesNotContain("/", CustomDeckGenerator.FileName(Deck() with { Title = "a/b:c" }));
    }
}
