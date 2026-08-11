using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using A = DocumentFormat.OpenXml.Drawing;
using P = DocumentFormat.OpenXml.Presentation;

namespace Asc.Api.Modules.Reports;

/// <summary>
/// Renders a ReportDto into a real, minimal .pptx: a title slide, then one slide per report
/// section. Deliberately no embedded charts or DrawingML tables — those are large, separate
/// OOXML object models, easy to get subtly wrong — a section's KPIs/Groups render as plain
/// text lines in the body placeholder instead. Every line is exactly what ReportGenerator
/// already computed; this is the honest, buildable-now equivalent of a chart, not a
/// placeholder to upgrade later under pressure.
///
/// DocumentFormat.OpenXml has only ever been used read-only in this codebase (see
/// Modules/Documents/DocumentTextExtractor.FromPowerPoint, for knowledge-base text
/// extraction) — this is the first thing that writes a .pptx, so it builds the minimal
/// presentation/theme/master/layout skeleton PowerPoint requires to open a file at all,
/// rather than relying on a pre-existing template.
/// </summary>
public static class PresentationGenerator
{
    private const int SlideWidthEmu = 12192000; // 16:9 widescreen
    private const int SlideHeightEmu = 6858000;

    public static byte[] Build(ReportDto report)
    {
        using var stream = new MemoryStream();
        using (var doc = PresentationDocument.Create(stream, PresentationDocumentType.Presentation))
        {
            var presentationPart = doc.AddPresentationPart();
            presentationPart.Presentation = new P.Presentation();

            var themePart = presentationPart.AddNewPart<ThemePart>();
            themePart.Theme = BuildTheme();

            var slideMasterPart = presentationPart.AddNewPart<SlideMasterPart>();
            slideMasterPart.AddPart(themePart);

            var slideLayoutPart = slideMasterPart.AddNewPart<SlideLayoutPart>();
            slideLayoutPart.SlideLayout = BuildTitleAndBodyLayout();

            slideMasterPart.SlideMaster = BuildSlideMaster(slideMasterPart.GetIdOfPart(slideLayoutPart));

            presentationPart.Presentation.Append(
                new P.SlideMasterIdList(new P.SlideMasterId { Id = 2147483648U, RelationshipId = presentationPart.GetIdOfPart(slideMasterPart) }));

            var slideIdList = new P.SlideIdList();
            presentationPart.Presentation.Append(slideIdList);
            presentationPart.Presentation.Append(new P.SlideSize { Cx = SlideWidthEmu, Cy = SlideHeightEmu });
            presentationPart.Presentation.Append(new P.NotesSize { Cx = 6858000, Cy = 9144000 });

            uint nextSlideId = 256;
            void AddSlide(string title, IReadOnlyList<string> bodyLines)
            {
                var slidePart = presentationPart.AddNewPart<SlidePart>();
                slidePart.AddPart(slideLayoutPart);
                slidePart.Slide = BuildSlide(title, bodyLines);
                slideIdList.Append(new P.SlideId { Id = nextSlideId++, RelationshipId = presentationPart.GetIdOfPart(slidePart) });
            }

            AddSlide(report.Title, [report.Subtitle, $"{report.SourceName} — generated {report.GeneratedAt:dd MMM yyyy, HH:mm} UTC"]);
            foreach (var section in report.Sections)
                AddSlide(section.Title, SectionLines(section));

            presentationPart.Presentation.Save();
        }
        return stream.ToArray();
    }

    private static List<string> SectionLines(ReportSectionDto section)
    {
        var lines = new List<string>();
        if (section.Kpis is { Count: > 0 })
        {
            foreach (var kpi in section.Kpis)
                lines.Add($"{kpi.Label}: {FormatKpi(kpi)}");
        }
        if (section.Groups is { Count: > 0 })
        {
            foreach (var g in section.Groups)
            {
                var parts = new List<string> { $"{g.Label} — {g.Count} lot{(g.Count == 1 ? "" : "s")}" };
                if (g.AverageValue.HasValue) parts.Add($"avg {g.AverageValue.Value:0.00}");
                if (g.Percent.HasValue) parts.Add($"{g.Percent.Value:0.0}%");
                lines.Add(string.Join(", ", parts));
            }
        }
        return lines.Count > 0 ? lines : ["No data."];
    }

    private static string FormatKpi(KpiDto kpi)
    {
        if (kpi.Value is not { } v) return "—";
        return kpi.Format == "currency" ? $"Rs. {v:0.00}" : v.ToString("0.##");
    }

    // ---- slide content --------------------------------------------------------------

    private static P.Slide BuildSlide(string title, IReadOnlyList<string> bodyLines)
    {
        var shapeTree = new P.ShapeTree(
            new P.NonVisualGroupShapeProperties(
                new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                new P.NonVisualGroupShapeDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.GroupShapeProperties(new A.TransformGroup()),
            BuildPlaceholderShape(2, "Title", P.PlaceholderValues.Title, TitleBody(title)),
            BuildPlaceholderShape(3, "Content", P.PlaceholderValues.Body, BodyText(bodyLines)));

        return new P.Slide(new P.CommonSlideData(shapeTree));
    }

    private static P.Shape BuildPlaceholderShape(uint id, string name, P.PlaceholderValues type, P.TextBody textBody) => new(
        new P.NonVisualShapeProperties(
            new P.NonVisualDrawingProperties { Id = id, Name = name },
            new P.NonVisualShapeDrawingProperties(new A.ShapeLocks { NoGrouping = true }),
            new P.ApplicationNonVisualDrawingProperties(new P.PlaceholderShape { Type = type })),
        new P.ShapeProperties(),
        textBody);

    private static P.TextBody TitleBody(string title)
    {
        var body = new P.TextBody(
            new A.BodyProperties(),
            new A.ListStyle(),
            new A.Paragraph(new A.Run(new A.Text(title))));
        return body;
    }

    private static P.TextBody BodyText(IReadOnlyList<string> lines)
    {
        var body = new P.TextBody(new A.BodyProperties(), new A.ListStyle());
        foreach (var line in lines)
            body.Append(new A.Paragraph(new A.Run(new A.Text(line))));
        return body;
    }

    /// <summary>The layout/master placeholder shapes carry no real text (the actual title/
    /// body content only exists per-slide), but &lt;p:txBody&gt; still requires at least one
    /// &lt;a:p&gt; — an empty paragraph, same as PowerPoint itself writes for an unused
    /// placeholder.</summary>
    private static P.TextBody EmptyPlaceholderTextBody() => new(new A.BodyProperties(), new A.ListStyle(), new A.Paragraph());

    // ---- layout / master / theme skeleton --------------------------------------------

    private static P.SlideLayout BuildTitleAndBodyLayout()
    {
        var shapeTree = new P.ShapeTree(
            new P.NonVisualGroupShapeProperties(
                new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                new P.NonVisualGroupShapeDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.GroupShapeProperties(new A.TransformGroup()),
            BuildPlaceholderShape(2, "Title Placeholder", P.PlaceholderValues.Title, EmptyPlaceholderTextBody()),
            BuildPlaceholderShape(3, "Content Placeholder", P.PlaceholderValues.Body, EmptyPlaceholderTextBody()));

        return new P.SlideLayout(new P.CommonSlideData(shapeTree), new P.ColorMapOverride(new A.MasterColorMapping()))
        {
            Type = P.SlideLayoutValues.Text,
        };
    }

    private static P.SlideMaster BuildSlideMaster(string slideLayoutRelationshipId)
    {
        var shapeTree = new P.ShapeTree(
            new P.NonVisualGroupShapeProperties(
                new P.NonVisualDrawingProperties { Id = 1, Name = "" },
                new P.NonVisualGroupShapeDrawingProperties(),
                new P.ApplicationNonVisualDrawingProperties()),
            new P.GroupShapeProperties(new A.TransformGroup()),
            BuildPlaceholderShape(2, "Title Placeholder", P.PlaceholderValues.Title, EmptyPlaceholderTextBody()),
            BuildPlaceholderShape(3, "Text Placeholder", P.PlaceholderValues.Body, EmptyPlaceholderTextBody()));

        return new P.SlideMaster(
            new P.CommonSlideData(shapeTree),
            new P.ColorMap
            {
                Background1 = A.ColorSchemeIndexValues.Light1,
                Text1 = A.ColorSchemeIndexValues.Dark1,
                Background2 = A.ColorSchemeIndexValues.Light2,
                Text2 = A.ColorSchemeIndexValues.Dark2,
                Accent1 = A.ColorSchemeIndexValues.Accent1,
                Accent2 = A.ColorSchemeIndexValues.Accent2,
                Accent3 = A.ColorSchemeIndexValues.Accent3,
                Accent4 = A.ColorSchemeIndexValues.Accent4,
                Accent5 = A.ColorSchemeIndexValues.Accent5,
                Accent6 = A.ColorSchemeIndexValues.Accent6,
                Hyperlink = A.ColorSchemeIndexValues.Hyperlink,
                FollowedHyperlink = A.ColorSchemeIndexValues.FollowedHyperlink,
            },
            new P.SlideLayoutIdList(new P.SlideLayoutId { Id = 2147483649U, RelationshipId = slideLayoutRelationshipId }));
    }

    /// <summary>A minimal but complete Office theme — every field PowerPoint requires to
    /// treat the file as valid, none of it visually distinctive (ASC's actual brand palette
    /// can replace these hex values later without touching the slide-building logic above).</summary>
    private static A.Theme BuildTheme()
    {
        var colorScheme = new A.ColorScheme(
            new A.Dark1Color(new A.SystemColor { Val = A.SystemColorValues.WindowText, LastColor = "000000" }),
            new A.Light1Color(new A.SystemColor { Val = A.SystemColorValues.Window, LastColor = "FFFFFF" }),
            new A.Dark2Color(new A.RgbColorModelHex { Val = "44546A" }),
            new A.Light2Color(new A.RgbColorModelHex { Val = "E7E6E6" }),
            new A.Accent1Color(new A.RgbColorModelHex { Val = "5B7A57" }),
            new A.Accent2Color(new A.RgbColorModelHex { Val = "8FAF8A" }),
            new A.Accent3Color(new A.RgbColorModelHex { Val = "A5A5A5" }),
            new A.Accent4Color(new A.RgbColorModelHex { Val = "FFC000" }),
            new A.Accent5Color(new A.RgbColorModelHex { Val = "4472C4" }),
            new A.Accent6Color(new A.RgbColorModelHex { Val = "70AD47" }),
            new A.Hyperlink(new A.RgbColorModelHex { Val = "0563C1" }),
            new A.FollowedHyperlinkColor(new A.RgbColorModelHex { Val = "954F72" }))
        {
            Name = "ASC Report Theme",
        };

        var fontScheme = new A.FontScheme(
            new A.MajorFont(new A.LatinFont { Typeface = "Calibri" }, new A.EastAsianFont { Typeface = "" }, new A.ComplexScriptFont { Typeface = "" }),
            new A.MinorFont(new A.LatinFont { Typeface = "Calibri" }, new A.EastAsianFont { Typeface = "" }, new A.ComplexScriptFont { Typeface = "" }))
        {
            Name = "ASC Report Fonts",
        };

        var formatScheme = new A.FormatScheme(
            new A.FillStyleList(
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor }),
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor }),
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor })),
            new A.LineStyleList(
                new A.Outline(new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor })),
                new A.Outline(new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor })),
                new A.Outline(new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor }))),
            new A.EffectStyleList(
                new A.EffectStyle(new A.EffectList()),
                new A.EffectStyle(new A.EffectList()),
                new A.EffectStyle(new A.EffectList())),
            new A.BackgroundFillStyleList(
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor }),
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor }),
                new A.SolidFill(new A.SchemeColor { Val = A.SchemeColorValues.PhColor })))
        {
            Name = "ASC Report Format",
        };

        return new A.Theme(new A.ThemeElements(colorScheme, fontScheme, formatScheme), new A.ObjectDefaults(), new A.ExtraColorSchemeList())
        {
            Name = "ASC Report Theme",
        };
    }
}
