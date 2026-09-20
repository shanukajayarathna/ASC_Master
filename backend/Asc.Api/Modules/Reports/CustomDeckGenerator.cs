using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using NPOI.XSSF.UserModel;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using P = DocumentFormat.OpenXml.Presentation;

namespace Asc.Api.Modules.Reports;

public record DeckSeriesDto(string Name, List<decimal?> Values);

/// <summary>One report in a deck — the dataset the Reports workspace preview computed from the archive.</summary>
public record DeckReportDto(
    string Title, string Scope, string Unit, string CategoryAxis, string Visual,
    List<string> Categories, List<DeckSeriesDto> Series);

public record CustomDeckRequest(string Title, string? Template, int? MaxSlides, List<DeckReportDto> Reports);

public enum DeckSlideKind { Title, Chart, Table }

public record DeckSlidePlan(DeckSlideKind Kind, int ReportIndex);

/// <summary>
/// Builds a PowerPoint deck for custom reports (the Reports workspace): a title slide, then for each report a
/// slide with a NATIVE chart (real PowerPoint chart parts with an embedded workbook, so "Edit Data" works and the
/// chart restyles like any other) and a slide with the data as a native table. Two templates: ASC Ivory (light,
/// the default) and ASC Ink (dark). Numbers are exactly the ones the caller passes — the archive-derived preview
/// dataset — and never pass through a language model. Capped at 12 slides.
/// </summary>
public static class CustomDeckGenerator
{
    public const int MaxSlides = 12;
    public const int MaxReports = 5;
    public const int MaxCategories = 14;
    public const int MaxSeries = 14;
    public const int MaxTextChars = 300;

    public static readonly IReadOnlyList<string> Templates = ["ivory", "ink"];

    private const int SlideW = 12192000; // 16:9
    private const int SlideH = 6858000;
    private const long In = 914400;

    private sealed record Palette(string Bg, string Text, string Muted, string Accent, string Rule, string HeadBg, string HeadText, string AltRow);

    private static readonly Palette Ivory = new("F6F3EA", "1C2420", "5B6660", "A8801F", "E4E0D3", "1C2420", "F6F3EA", "EFEBDD");
    private static readonly Palette Ink = new("1B2A22", "F6F3EA", "B9C2BB", "D9B45B", "2F4238", "D9B45B", "1B2A22", "22362B");

    private static readonly string[] SeriesColors = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "4A3AA7", "E34948"];
    private static readonly Dictionary<string, string> BrokerColors = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ASC"] = "17A2B8", ["BC"] = "6F42C1", ["CT"] = "D6338F", ["EB"] = "1E7145",
        ["FW"] = "2E86DE", ["JK"] = "D63031", ["LC"] = "E67E22", ["MPB"] = "F0B429",
    };

    private const string SourceLine = "Source: ASC Intelligence Hub — MSL auction archive.";

    // ------------------------------------------------------------------ validation and planning (pure)

    /// <summary>Null when the request can be built, otherwise the message to return.</summary>
    public static string? Validate(CustomDeckRequest? req)
    {
        if (req is null) return "A deck request is required.";
        if (string.IsNullOrWhiteSpace(req.Title)) return "A deck needs a title.";
        if (req.Title.Trim().Length > MaxTextChars) return $"The title can be at most {MaxTextChars} characters.";
        if (req.Template is not null && !Templates.Contains(req.Template.ToLowerInvariant()))
            return $"Unknown template '{req.Template}'. Use one of: {string.Join(", ", Templates)}.";
        if (req.Reports is not { Count: > 0 }) return "Add at least one report to the deck.";
        if (req.Reports.Count > MaxReports) return $"A deck can hold at most {MaxReports} reports.";
        foreach (var r in req.Reports)
        {
            if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Length > MaxTextChars) return "Every report needs a title of up to 300 characters.";
            if ((r.Scope?.Length ?? 0) > 1000) return "A report's scope is too long.";
            if (r.Categories is not { Count: > 0 } || r.Categories.Count > MaxCategories) return $"A report needs 1-{MaxCategories} categories.";
            if (r.Series is not { Count: > 0 } || r.Series.Count > MaxSeries) return $"A report needs 1-{MaxSeries} series.";
            if (r.Categories.Any(c => c is null || c.Length > MaxTextChars) || r.Series.Any(s => s.Name is null || s.Name.Length > MaxTextChars))
                return "A category or series name is too long.";
            if (r.Series.Any(s => s.Values is null || s.Values.Count != r.Categories.Count))
                return "Every series needs exactly one value per category.";
            if (r.Visual is not null && r.Visual is not ("bar" or "line" or "table")) return $"Unknown visual '{r.Visual}'.";
        }
        return null;
    }

    /// <summary>The slides in order, cut to the requested count: the title slide always first, then for each report
    /// its chart slide (unless it was designed as a table) and its table slide.</summary>
    public static IReadOnlyList<DeckSlidePlan> Plan(CustomDeckRequest req)
    {
        var plan = new List<DeckSlidePlan> { new(DeckSlideKind.Title, -1) };
        for (var i = 0; i < req.Reports.Count; i++)
        {
            if (req.Reports[i].Visual != "table") plan.Add(new(DeckSlideKind.Chart, i));
            plan.Add(new(DeckSlideKind.Table, i));
        }
        var max = Math.Clamp(req.MaxSlides ?? MaxSlides, 2, MaxSlides);
        return plan.Take(max).ToList();
    }

    public static int AvailableSlides(CustomDeckRequest req) => Math.Min(MaxSlides, Plan(req with { MaxSlides = MaxSlides }).Count);

    private static string SafeName(string s) => new string(s.Where(ch => !Path.GetInvalidFileNameChars().Contains(ch)).ToArray()).Trim();

    public static string FileName(CustomDeckRequest req) => $"{(SafeName(req.Title) is { Length: > 0 } n ? n : "report-deck")}.pptx";

    // ------------------------------------------------------------------ building

    public static byte[] Build(CustomDeckRequest req)
    {
        var problem = Validate(req);
        if (problem is not null) throw new ArgumentException(problem, nameof(req));

        var palette = string.Equals(req.Template, "ink", StringComparison.OrdinalIgnoreCase) ? Ink : Ivory;
        var plan = Plan(req);

        using var stream = new MemoryStream();
        using (var doc = PresentationDocument.Create(stream, PresentationDocumentType.Presentation))
        {
            var presentationPart = doc.AddPresentationPart();
            presentationPart.Presentation = new P.Presentation();

            var themePart = presentationPart.AddNewPart<ThemePart>();
            themePart.Theme = PresentationGenerator.BuildTheme();
            var slideMasterPart = presentationPart.AddNewPart<SlideMasterPart>();
            slideMasterPart.AddPart(themePart);
            var layoutPart = slideMasterPart.AddNewPart<SlideLayoutPart>();
            layoutPart.SlideLayout = PresentationGenerator.BuildTitleAndBodyLayout();
            slideMasterPart.SlideMaster = PresentationGenerator.BuildSlideMaster(slideMasterPart.GetIdOfPart(layoutPart));

            presentationPart.Presentation.Append(new P.SlideMasterIdList(
                new P.SlideMasterId { Id = 2147483648U, RelationshipId = presentationPart.GetIdOfPart(slideMasterPart) }));
            var slideIds = new P.SlideIdList();
            presentationPart.Presentation.Append(slideIds);
            presentationPart.Presentation.Append(new P.SlideSize { Cx = SlideW, Cy = SlideH });
            presentationPart.Presentation.Append(new P.NotesSize { Cx = 6858000, Cy = 9144000 });

            uint nextId = 256;
            foreach (var step in plan)
            {
                var slidePart = presentationPart.AddNewPart<SlidePart>();
                slidePart.AddPart(layoutPart);
                slidePart.Slide = step.Kind switch
                {
                    DeckSlideKind.Title => TitleSlide(req, palette),
                    DeckSlideKind.Chart => ChartSlide(slidePart, req.Reports[step.ReportIndex], palette),
                    _ => TableSlide(req.Reports[step.ReportIndex], palette),
                };
                slideIds.Append(new P.SlideId { Id = nextId++, RelationshipId = presentationPart.GetIdOfPart(slidePart) });
            }

            presentationPart.Presentation.Save();
        }
        return stream.ToArray();
    }

    // ------------------------------------------------------------------ slides

    private static P.Slide NewSlide(Palette p, params OpenXmlElement[] shapes)
    {
        var tree = new P.ShapeTree(
            new P.NonVisualGroupShapeProperties(
                new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                new P.NonVisualGroupShapeDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.GroupShapeProperties(new A.TransformGroup()));
        foreach (var s in shapes) tree.Append(s);
        var background = new P.Background(new P.BackgroundProperties(new A.SolidFill(new A.RgbColorModelHex { Val = p.Bg }), new A.EffectList()));
        return new P.Slide(new P.CommonSlideData(background, tree), new P.ColorMapOverride(new A.MasterColorMapping()));
    }

    private static P.Slide TitleSlide(CustomDeckRequest req, Palette p)
    {
        var reportLine = string.Join("  ·  ", req.Reports.Select(r => r.Title));
        return NewSlide(p,
            Rule(2, "Accent rule", 1 * In, 2 * In, 1 * In, 60000, p.Accent),
            TextBox(3, "Title", 1 * In, 2 * In + 200000, 11 * In, 1600000, [Para(req.Title.Trim(), 4400, p.Text, bold: true)], A.TextAnchoringTypeValues.Top),
            TextBox(4, "Reports", 1 * In, 4 * In, 11 * In, 900000, [Para(reportLine, 1800, p.Muted)], A.TextAnchoringTypeValues.Top),
            TextBox(5, "Source", 1 * In, 6 * In + 300000, 11 * In, 400000,
                [Para($"{SourceLine} Generated {DateTime.UtcNow:dd MMM yyyy} UTC.", 1100, p.Muted)], A.TextAnchoringTypeValues.Top));
    }

    private static P.Slide ChartSlide(SlidePart slidePart, DeckReportDto r, Palette p)
    {
        var line = r.Visual == "line" && r.Categories.Count >= 2;
        var chartPart = slidePart.AddNewPart<ChartPart>();
        var workbook = chartPart.AddEmbeddedPackagePart("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        using (var wb = new MemoryStream(BuildWorkbook(r))) workbook.FeedData(wb);
        chartPart.ChartSpace = BuildChartSpace(r, line, p, chartPart.GetIdOfPart(workbook));
        var chartRelId = slidePart.GetIdOfPart(chartPart);

        var frame = new P.GraphicFrame(
            new P.NonVisualGraphicFrameProperties(
                new P.NonVisualDrawingProperties { Id = 5, Name = "Chart" },
                new P.NonVisualGraphicFrameDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.Transform(new A.Offset { X = 600000, Y = 1500000 }, new A.Extents { Cx = SlideW - 1200000, Cy = 4500000 }),
            new A.Graphic(new A.GraphicData(new C.ChartReference { Id = chartRelId }) { Uri = "http://schemas.openxmlformats.org/drawingml/2006/chart" }));

        return NewSlide(p,
            TextBox(2, "Title", 600000, 300000, SlideW - 1200000, 700000, [Para(r.Title, 2800, p.Text, bold: true)], A.TextAnchoringTypeValues.Bottom),
            TextBox(3, "Scope", 600000, 1000000, SlideW - 1200000, 450000, [Para(r.Scope ?? "", 1400, p.Muted)], A.TextAnchoringTypeValues.Top),
            frame,
            TextBox(6, "Source", 600000, 6250000, SlideW - 1200000, 350000, [Para(SourceLine, 1000, p.Muted)], A.TextAnchoringTypeValues.Top));
    }

    private static P.Slide TableSlide(DeckReportDto r, Palette p)
    {
        var cols = 1 + r.Series.Count;
        var totalW = SlideW - 1200000;
        var firstW = cols == 1 ? totalW : Math.Min(totalW / 3, 3200000);
        var otherW = cols == 1 ? 0 : Math.Min((totalW - firstW) / (cols - 1), 2600000);
        totalW = cols == 1 ? totalW : firstW + otherW * (cols - 1);
        var rowH = 340000;

        var grid = new A.TableGrid(new A.GridColumn { Width = firstW });
        for (var i = 1; i < cols; i++) grid.Append(new A.GridColumn { Width = otherW });

        var table = new A.Table(new A.TableProperties { FirstRow = true, BandRow = true }, grid);
        table.Append(Row(rowH, [r.CategoryAxis, .. r.Series.Select(s => s.Name)], p.HeadBg, p.HeadText, true, false));
        for (var i = 0; i < r.Categories.Count; i++)
        {
            var fill = i % 2 == 1 ? p.AltRow : p.Bg;
            table.Append(Row(rowH, [r.Categories[i], .. r.Series.Select(s => Format(s.Values[i]))], fill, p.Text, false, true));
        }

        var frame = new P.GraphicFrame(
            new P.NonVisualGraphicFrameProperties(
                new P.NonVisualDrawingProperties { Id = 4, Name = "Table" },
                new P.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoGrouping = true }),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.Transform(new A.Offset { X = 600000, Y = 1500000 }, new A.Extents { Cx = totalW, Cy = rowH * (r.Categories.Count + 1) }),
            new A.Graphic(new A.GraphicData(table) { Uri = "http://schemas.openxmlformats.org/drawingml/2006/table" }));

        return NewSlide(p,
            TextBox(2, "Title", 600000, 300000, SlideW - 1200000, 700000, [Para($"{r.Title} — data", 2800, p.Text, bold: true)], A.TextAnchoringTypeValues.Bottom),
            TextBox(3, "Scope", 600000, 1000000, SlideW - 1200000, 450000, [Para($"{r.Scope} · unit: {r.Unit}", 1400, p.Muted)], A.TextAnchoringTypeValues.Top),
            frame,
            TextBox(5, "Source", 600000, 6250000, SlideW - 1200000, 350000, [Para(SourceLine, 1000, p.Muted)], A.TextAnchoringTypeValues.Top));
    }

    private static A.TableRow Row(int height, IReadOnlyList<string> cells, string fill, string textColor, bool bold, bool numbersRight)
    {
        var row = new A.TableRow { Height = height };
        for (var i = 0; i < cells.Count; i++)
        {
            var align = numbersRight && i > 0 ? A.TextAlignmentTypeValues.Right : A.TextAlignmentTypeValues.Left;
            row.Append(new A.TableCell(
                new A.TextBody(new A.BodyProperties(), new A.ListStyle(), Para(cells[i], 1300, textColor, bold, align)),
                new A.TableCellProperties(new A.SolidFill(new A.RgbColorModelHex { Val = fill })) { Anchor = A.TextAnchoringTypeValues.Center }));
        }
        return row;
    }

    private static string Format(decimal? v) => v is null ? "—" : v.Value.ToString("#,##0.##", System.Globalization.CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ shapes and text

    private static A.Paragraph Para(string text, int size, string color, bool bold = false, A.TextAlignmentTypeValues? align = null)
    {
        var props = new A.ParagraphProperties();
        if (align is { } a) props.Alignment = a;
        return new A.Paragraph(
            props,
            new A.Run(
                new A.RunProperties(new A.SolidFill(new A.RgbColorModelHex { Val = color }), new A.LatinFont { Typeface = "Calibri" })
                { Language = "en-US", FontSize = size, Bold = bold, Dirty = false },
                new A.Text(text)));
    }

    private static P.Shape TextBox(uint id, string name, long x, long y, long cx, long cy, IEnumerable<A.Paragraph> paragraphs, A.TextAnchoringTypeValues anchor)
    {
        var body = new P.TextBody(new A.BodyProperties { Wrap = A.TextWrappingValues.Square, Anchor = anchor }, new A.ListStyle());
        foreach (var para in paragraphs) body.Append(para);
        return new P.Shape(
            new P.NonVisualShapeProperties(
                new P.NonVisualDrawingProperties { Id = id, Name = name },
                new P.NonVisualShapeDrawingProperties(new A.ShapeLocks { NoGrouping = true }) { TextBox = true },
                new P.ApplicationNonVisualDrawingProperties()),
            new P.ShapeProperties(
                new A.Transform2D(new A.Offset { X = x, Y = y }, new A.Extents { Cx = cx, Cy = cy }),
                new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle },
                new A.NoFill()),
            body);
    }

    private static P.Shape Rule(uint id, string name, long x, long y, long cx, long cy, string color) => new(
        new P.NonVisualShapeProperties(
            new P.NonVisualDrawingProperties { Id = id, Name = name },
            new P.NonVisualShapeDrawingProperties(),
            new P.ApplicationNonVisualDrawingProperties()),
        new P.ShapeProperties(
            new A.Transform2D(new A.Offset { X = x, Y = y }, new A.Extents { Cx = cx, Cy = cy }),
            new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle },
            new A.SolidFill(new A.RgbColorModelHex { Val = color })));

    // ------------------------------------------------------------------ chart

    private static string ColLetter(int zeroBased) => ((char)('A' + zeroBased)).ToString();

    private static byte[] BuildWorkbook(DeckReportDto r)
    {
        using var wb = new XSSFWorkbook();
        var sheet = wb.CreateSheet("Sheet1");
        var head = sheet.CreateRow(0);
        head.CreateCell(0).SetCellValue(r.CategoryAxis);
        for (var s = 0; s < r.Series.Count; s++) head.CreateCell(s + 1).SetCellValue(r.Series[s].Name);
        for (var i = 0; i < r.Categories.Count; i++)
        {
            var row = sheet.CreateRow(i + 1);
            row.CreateCell(0).SetCellValue(r.Categories[i]);
            for (var s = 0; s < r.Series.Count; s++)
                if (r.Series[s].Values[i] is { } v) row.CreateCell(s + 1).SetCellValue((double)v);
        }
        using var ms = new MemoryStream();
        wb.Write(ms, true);
        return ms.ToArray();
    }

    private static C.StringReference StringRef(string formula, IReadOnlyList<string> values)
    {
        var cache = new C.StringCache(new C.PointCount { Val = (uint)values.Count });
        for (var i = 0; i < values.Count; i++) cache.Append(new C.StringPoint(new C.NumericValue(values[i])) { Index = (uint)i });
        return new C.StringReference(new C.Formula(formula), cache);
    }

    private static C.NumberReference NumberRef(string formula, IReadOnlyList<decimal?> values)
    {
        var cache = new C.NumberingCache(new C.FormatCode("General"), new C.PointCount { Val = (uint)values.Count });
        for (var i = 0; i < values.Count; i++)
            if (values[i] is { } v) cache.Append(new C.NumericPoint(new C.NumericValue(v.ToString(System.Globalization.CultureInfo.InvariantCulture))) { Index = (uint)i });
        return new C.NumberReference(new C.Formula(formula), cache);
    }

    private static A.SolidFill Fill(string hex) => new(new A.RgbColorModelHex { Val = hex });

    private static C.ChartSpace BuildChartSpace(DeckReportDto r, bool line, Palette p, string workbookRelId)
    {
        var n = r.Categories.Count;
        var multi = r.Series.Count > 1;
        var catFormula = $"Sheet1!$A$2:$A${n + 1}";
        // A single series keeps each broker's own colour on its bar; several series get one colour each.
        var perPointBrokerColours = !multi && !line && r.Categories.All(c => BrokerColors.ContainsKey(c));

        OpenXmlElement plot;
        if (line)
        {
            var chart = new C.LineChart(new C.Grouping { Val = C.GroupingValues.Standard }, new C.VaryColors { Val = false });
            for (var s = 0; s < r.Series.Count; s++)
            {
                var color = SeriesColour(r.Series[s].Name, s);
                var col = ColLetter(s + 1);
                chart.Append(new C.LineChartSeries(
                    new C.Index { Val = (uint)s }, new C.Order { Val = (uint)s },
                    new C.SeriesText(StringRef($"Sheet1!${col}$1", [r.Series[s].Name])),
                    new C.ChartShapeProperties(new A.Outline(Fill(color)) { Width = 28575, CapType = A.LineCapValues.Round }),
                    new C.Marker(new C.Symbol { Val = C.MarkerStyleValues.Circle }, new C.Size { Val = 6 },
                        new C.ChartShapeProperties(Fill(color))),
                    new C.CategoryAxisData(StringRef(catFormula, r.Categories)),
                    new C.Values(NumberRef($"Sheet1!${col}$2:${col}${n + 1}", r.Series[s].Values)),
                    new C.Smooth { Val = false }));
            }
            chart.Append(new C.ShowMarker { Val = true }, new C.AxisId { Val = 111111111U }, new C.AxisId { Val = 222222222U });
            plot = chart;
        }
        else
        {
            var chart = new C.BarChart(new C.BarDirection { Val = C.BarDirectionValues.Column }, new C.BarGrouping { Val = C.BarGroupingValues.Clustered }, new C.VaryColors { Val = false });
            for (var s = 0; s < r.Series.Count; s++)
            {
                var color = SeriesColour(r.Series[s].Name, s);
                var col = ColLetter(s + 1);
                var series = new C.BarChartSeries(
                    new C.Index { Val = (uint)s }, new C.Order { Val = (uint)s },
                    new C.SeriesText(StringRef($"Sheet1!${col}$1", [r.Series[s].Name])),
                    new C.ChartShapeProperties(Fill(color)),
                    new C.InvertIfNegative { Val = false });
                if (perPointBrokerColours)
                    for (var i = 0; i < n; i++)
                        series.Append(new C.DataPoint(new C.Index { Val = (uint)i }, new C.InvertIfNegative { Val = false }, new C.Bubble3D { Val = false },
                            new C.ChartShapeProperties(Fill(BrokerColors[r.Categories[i]]))));
                if (!multi && n <= 8)
                    series.Append(new C.DataLabels(
                        new C.NumberingFormat { FormatCode = r.Unit == "Rs/kg" ? "#,##0.0" : "#,##0", SourceLinked = false },
                        new C.ChartShapeProperties(new A.NoFill()),
                        new C.TextProperties(new A.BodyProperties(), new A.ListStyle(), new A.Paragraph(
                            new A.ParagraphProperties(new A.DefaultRunProperties(Fill(p.Text)) { FontSize = 1200 }),
                            new A.EndParagraphRunProperties { Language = "en-US" })),
                        new C.ShowLegendKey { Val = false }, new C.ShowValue { Val = true }, new C.ShowCategoryName { Val = false },
                        new C.ShowSeriesName { Val = false }, new C.ShowPercent { Val = false }, new C.ShowBubbleSize { Val = false }));
                series.Append(
                    new C.CategoryAxisData(StringRef(catFormula, r.Categories)),
                    new C.Values(NumberRef($"Sheet1!${col}$2:${col}${n + 1}", r.Series[s].Values)));
                chart.Append(series);
            }
            chart.Append(new C.GapWidth { Val = 80 }, new C.AxisId { Val = 111111111U }, new C.AxisId { Val = 222222222U });
            plot = chart;
        }

        var textProps = () => new C.TextProperties(new A.BodyProperties(), new A.ListStyle(), new A.Paragraph(
            new A.ParagraphProperties(new A.DefaultRunProperties(Fill(p.Muted)) { FontSize = 1200 }),
            new A.EndParagraphRunProperties { Language = "en-US" }));

        var catAxis = new C.CategoryAxis(
            new C.AxisId { Val = 111111111U },
            new C.Scaling(new C.Orientation { Val = C.OrientationValues.MinMax }),
            new C.Delete { Val = false },
            new C.AxisPosition { Val = C.AxisPositionValues.Bottom },
            new C.MajorTickMark { Val = C.TickMarkValues.None },
            new C.MinorTickMark { Val = C.TickMarkValues.None },
            new C.TickLabelPosition { Val = C.TickLabelPositionValues.NextTo },
            new C.ChartShapeProperties(new A.Outline(Fill(p.Rule))),
            textProps(),
            new C.CrossingAxis { Val = 222222222U },
            new C.Crosses { Val = C.CrossesValues.AutoZero },
            new C.AutoLabeled { Val = true },
            new C.LabelAlignment { Val = C.LabelAlignmentValues.Center },
            new C.LabelOffset { Val = 100 },
            new C.NoMultiLevelLabels { Val = false });

        var valAxis = new C.ValueAxis(
            new C.AxisId { Val = 222222222U },
            new C.Scaling(new C.Orientation { Val = C.OrientationValues.MinMax }),
            new C.Delete { Val = false },
            new C.AxisPosition { Val = C.AxisPositionValues.Left },
            new C.MajorGridlines(new C.ChartShapeProperties(new A.Outline(Fill(p.Rule)))),
            new C.NumberingFormat { FormatCode = "#,##0", SourceLinked = false },
            new C.MajorTickMark { Val = C.TickMarkValues.None },
            new C.MinorTickMark { Val = C.TickMarkValues.None },
            new C.TickLabelPosition { Val = C.TickLabelPositionValues.NextTo },
            new C.ChartShapeProperties(new A.Outline(new A.NoFill())),
            textProps(),
            new C.CrossingAxis { Val = 111111111U },
            new C.Crosses { Val = C.CrossesValues.AutoZero },
            new C.CrossBetween { Val = C.CrossBetweenValues.Between });

        var chartEl = new C.Chart(new C.AutoTitleDeleted { Val = true }, new C.PlotArea(new C.Layout(), plot, catAxis, valAxis));
        if (multi)
            chartEl.Append(new C.Legend(new C.LegendPosition { Val = C.LegendPositionValues.Bottom }, new C.Overlay { Val = false }, textProps()));
        chartEl.Append(new C.PlotVisibleOnly { Val = true }, new C.DisplayBlanksAs { Val = C.DisplayBlanksAsValues.Gap });

        return new C.ChartSpace(
            new C.Date1904 { Val = false },
            new C.RoundedCorners { Val = false },
            chartEl,
            new C.ChartShapeProperties(new A.NoFill(), new A.Outline(new A.NoFill())),
            new C.ExternalData(new C.AutoUpdate { Val = false }) { Id = workbookRelId });
    }

    private static string SeriesColour(string name, int index) =>
        BrokerColors.TryGetValue(name, out var c) ? c : name == "Other" ? "9AA0A6" : SeriesColors[index % SeriesColors.Length];
}
