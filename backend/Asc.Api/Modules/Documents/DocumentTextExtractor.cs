using System.Text;
using DocumentFormat.OpenXml.Packaging;
using NPOI.SS.UserModel;
using NPOI.XWPF.UserModel;
using UglyToad.PdfPig;

namespace Asc.Api.Modules.Documents;

/// <summary>Turns an uploaded file into plain text, dispatched by extension — then splits that
/// text into overlapping chunks small enough to embed individually.</summary>
public static class DocumentTextExtractor
{
    public static string ExtractText(Stream data, string extension) => extension.ToLowerInvariant() switch
    {
        "pdf" => FromPdf(data),
        "docx" => FromWord(data),
        "pptx" => FromPowerPoint(data),
        "xlsx" or "xls" => FromExcel(data),
        _ => throw new NotSupportedException($"Unsupported document type: .{extension}"),
    };

    private static string FromPdf(Stream data)
    {
        using var pdf = PdfDocument.Open(data);
        var sb = new StringBuilder();
        foreach (var page in pdf.GetPages())
            sb.AppendLine(page.Text);
        return sb.ToString();
    }

    private static string FromWord(Stream data)
    {
        using var doc = new XWPFDocument(data);
        var sb = new StringBuilder();
        foreach (var para in doc.Paragraphs)
            sb.AppendLine(para.Text);
        foreach (var table in doc.Tables)
            foreach (var row in table.Rows)
                foreach (var cell in row.GetTableCells())
                    sb.AppendLine(cell.GetText());
        return sb.ToString();
    }

    // NPOI's bundled OOXML support (used for .docx above) doesn't include PowerPoint
    // (XSLF) in this build — confirmed by reflecting over its assemblies, nothing under
    // an XSLF/Slide namespace exists. DocumentFormat.OpenXml (Microsoft's own SDK) fills
    // just this one gap rather than switching every format to it.
    private static string FromPowerPoint(Stream data)
    {
        using var doc = PresentationDocument.Open(data, false);
        var sb = new StringBuilder();
        var slideParts = doc.PresentationPart?.SlideParts ?? [];
        foreach (var slidePart in slideParts)
            foreach (var text in slidePart.Slide.Descendants<DocumentFormat.OpenXml.Drawing.Text>())
                sb.AppendLine(text.Text);
        return sb.ToString();
    }

    private static string FromExcel(Stream data)
    {
        // Raw typed-value read, not NPOI's DataFormatter — CatalogueImportService.cs found that
        // path pulls in a SkiaSharp dependency that throws FileNotFoundException on some cell
        // formats. Same avoidance here, simplified since this only needs readable text, not
        // catalogue-accurate number/date formatting.
        using var wb = WorkbookFactory.Create(data);
        var sb = new StringBuilder();
        for (var s = 0; s < wb.NumberOfSheets; s++)
        {
            var sheet = wb.GetSheetAt(s);
            for (var r = 0; r <= sheet.LastRowNum; r++)
            {
                var row = sheet.GetRow(r);
                if (row is null) continue;
                var cells = row.Cells.Select(CellToString).Where(t => t.Length > 0);
                var line = string.Join(" | ", cells);
                if (line.Length > 0) sb.AppendLine(line);
            }
        }
        return sb.ToString();
    }

    private static string CellToString(NPOI.SS.UserModel.ICell cell)
    {
        try
        {
            return cell.CellType switch
            {
                CellType.Numeric => cell.NumericCellValue.ToString(System.Globalization.CultureInfo.InvariantCulture),
                CellType.String => cell.StringCellValue,
                CellType.Boolean => cell.BooleanCellValue.ToString(),
                CellType.Formula => cell.ToString() ?? string.Empty,
                _ => string.Empty,
            };
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>Splits text into ~sizeChars chunks with overlapChars of repeated context at each
    /// boundary, so a fact split across a chunk edge is still findable from either side. Character-
    /// based, not token-based — good enough for v1 without pulling in a tokenizer.</summary>
    public static List<string> Chunk(string text, int sizeChars = 800, int overlapChars = 100)
    {
        var normalized = text.Trim();
        if (normalized.Length == 0) return [];
        if (normalized.Length <= sizeChars) return [normalized];

        var chunks = new List<string>();
        var start = 0;
        while (start < normalized.Length)
        {
            var length = Math.Min(sizeChars, normalized.Length - start);
            chunks.Add(normalized.Substring(start, length));
            if (start + length >= normalized.Length) break;
            start += sizeChars - overlapChars;
        }
        return chunks;
    }
}
