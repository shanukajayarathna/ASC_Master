using SkiaSharp;

namespace Asc.Api.Modules.Reports;

/// <summary>
/// Renders a ReportDto into a real, paginated PDF using SkiaSharp's PDF canvas (already a
/// project dependency for document text extraction — no new package, no licensing decision).
/// Deliberately plain: title block, then one KPI/table block per section, wrapping onto a new
/// page whenever a table runs past the page bottom. No charts — same honesty rule as
/// PresentationGenerator: every line is a number ReportGenerator already computed, not a
/// placeholder to upgrade later under pressure.
/// </summary>
public static class PdfReportGenerator
{
    private const float PageWidth = 595f;  // A4 at 72dpi
    private const float PageHeight = 842f;
    private const float Margin = 40f;
    private const float LineHeight = 16f;

    public static byte[] Build(ReportDto report)
    {
        using var stream = new MemoryStream();
        using (var doc = SKDocument.CreatePdf(stream))
        {
            var arial = SKTypeface.FromFamilyName("Arial") ?? SKTypeface.Default;
            var arialBold = SKTypeface.FromFamilyName("Arial", SKFontStyleWeight.Bold, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright) ?? arial;

            var titleFont = new SKFont { Typeface = arialBold, Size = 20 };
            var subFont = new SKFont { Typeface = arial, Size = 11 };
            var headerFont = new SKFont { Typeface = arialBold, Size = 13 };
            var bodyFont = new SKFont { Typeface = arial, Size = 10.5f };
            var textPaint = new SKPaint { Color = SKColors.Black, IsAntialias = true };
            var mutedPaint = new SKPaint { Color = new SKColor(90, 90, 90), IsAntialias = true };
            var brandPaint = new SKPaint { Color = new SKColor(0x17, 0x4E, 0x4A), IsAntialias = true }; // ASC teal, dark enough for print

            SKCanvas? canvas = null;
            var pageOpen = false;
            float y = 0;

            void NewPage()
            {
                if (pageOpen) doc.EndPage();
                canvas = doc.BeginPage(PageWidth, PageHeight);
                pageOpen = true;
                y = Margin;
            }

            void EnsureRoom(float needed)
            {
                if (y + needed > PageHeight - Margin) NewPage();
            }

            void Text(string s, SKFont font, SKPaint paint, float x, float advance)
            {
                canvas!.DrawText(s, x, y, SKTextAlign.Left, font, paint);
                y += advance;
            }

            NewPage();
            Text("Asia Siyaka Commodities", titleFont, brandPaint, Margin, 26);
            Text(report.Title, headerFont, textPaint, Margin, 20);
            Text(report.Subtitle, subFont, mutedPaint, Margin, 16);
            Text($"{report.SourceName} — generated {report.GeneratedAt:dd MMM yyyy, HH:mm} UTC", subFont, mutedPaint, Margin, 24);

            foreach (var section in report.Sections)
            {
                EnsureRoom(LineHeight * 3);
                y += 6;
                Text(section.Title, headerFont, brandPaint, Margin, 20);

                if (section.Kpis is { Count: > 0 })
                {
                    foreach (var kpi in section.Kpis)
                    {
                        EnsureRoom(LineHeight);
                        Text($"{kpi.Label}:  {FormatKpi(kpi)}", bodyFont, textPaint, Margin + 8, LineHeight);
                    }
                }

                if (section.Groups is { Count: > 0 })
                {
                    var unit = section.GroupUnitLabel ?? "Label";
                    var hasAvg = section.Groups.Any(g => g.AverageValue.HasValue);
                    var hasPct = section.Groups.Any(g => g.Percent.HasValue);

                    float colLabel = Margin + 8, colCount = 300, colAvg = 380, colPct = 480;
                    EnsureRoom(LineHeight * 2);
                    canvas!.DrawText(unit, colLabel, y, SKTextAlign.Left, bodyFont, mutedPaint);
                    canvas.DrawText("Lots", colCount, y, SKTextAlign.Left, bodyFont, mutedPaint);
                    if (hasAvg) canvas.DrawText("Avg", colAvg, y, SKTextAlign.Left, bodyFont, mutedPaint);
                    if (hasPct) canvas.DrawText("%", colPct, y, SKTextAlign.Left, bodyFont, mutedPaint);
                    y += LineHeight;
                    canvas.DrawLine(Margin, y - 10, PageWidth - Margin, y - 10, mutedPaint);

                    foreach (var g in section.Groups)
                    {
                        EnsureRoom(LineHeight);
                        var label = g.Label.Length > 40 ? g.Label[..37] + "..." : g.Label;
                        canvas!.DrawText(label, colLabel, y, SKTextAlign.Left, bodyFont, textPaint);
                        canvas.DrawText(g.Count.ToString("N0"), colCount, y, SKTextAlign.Left, bodyFont, textPaint);
                        if (hasAvg && g.AverageValue.HasValue)
                            canvas.DrawText(g.AverageValue.Value.ToString("N2"), colAvg, y, SKTextAlign.Left, bodyFont, textPaint);
                        if (hasPct && g.Percent.HasValue)
                            canvas.DrawText($"{g.Percent.Value:0.0}%", colPct, y, SKTextAlign.Left, bodyFont, textPaint);
                        y += LineHeight;
                    }
                }

                if (section.Kpis is not { Count: > 0 } && section.Groups is not { Count: > 0 })
                    Text("No data.", bodyFont, mutedPaint, Margin + 8, LineHeight);
            }

            if (pageOpen) doc.EndPage();
            doc.Close();
        }
        return stream.ToArray();
    }

    private static string FormatKpi(KpiDto kpi)
    {
        if (kpi.Value is not { } v) return "—";
        return kpi.Format == "currency" ? $"Rs. {v:N2}" : v.ToString("N0");
    }
}
