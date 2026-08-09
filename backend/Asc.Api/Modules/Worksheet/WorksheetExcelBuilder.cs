using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.Worksheet;

/// <summary>
/// Line-for-line port of the original standalone Worksheet tool's excel-report.js
/// (window.ExcelReport.exportReport) onto NPOI: same palette, same letterhead (logo + plain
/// colored text, no fill bands — deliberately different from Combined Report's navy/blue
/// banner treatment, which was a separate, later request specific to that report), same three
/// metric summary boxes, same per-column alignment (numeric right / text left), zebra-striped
/// data rows, thin gray grid with a medium navy frame, autofilter and a frozen header row.
/// </summary>
public class WorksheetExcelBuilder(IWebHostEnvironment env)
{
    // Exact palette from excel-report.js.
    private static readonly byte[] NavyRgb = [0x0B, 0x25, 0x45];
    private static readonly byte[] MutedRgb = [0x5A, 0x64, 0x78];
    private static readonly byte[] LabelRgb = [0x3A, 0x52, 0x6E];
    private static readonly byte[] BoxFillRgb = [0xE8, 0xF2, 0xFF];
    private static readonly byte[] BoxBorderRgb = [0x3A, 0x7C, 0xD2];
    private static readonly byte[] GridRgb = [0x7A, 0x87, 0x98];
    private static readonly byte[] AltFillRgb = [0xF2, 0xF7, 0xFD];
    private static readonly byte[] TextRgb = [0x1A, 0x26, 0x34];
    private const string NumFmt = "#,##0.00";

    // Column order matches the original's DEFAULT_COLUMNS (broker first); any currently-shown
    // extra column (e.g. "Invoice No") is inserted right after Total Weight, before the
    // Valuation/Total Proceeds/Remarks block that's always last.
    private static List<(string Header, int Width, bool Numeric, bool Wrap)> BuildColumns(List<string> extraKeys, string valuationLabel, string proceedsLabel)
    {
        var cols = new List<(string, int, bool, bool)>
        {
            ("Broker", 14, false, false),
            ("Lot No", 13, false, false),
            ("Selling Mark", 16, false, false),
            ("Grade", 10, false, false),
            ("Bags", 9, true, false),
            ("Net Weight", 12, true, false),
            ("Total Weight", 13, true, false),
        };
        foreach (var key in extraKeys) cols.Add((key, 16, false, false));
        cols.Add((valuationLabel, 16, true, false));
        cols.Add((proceedsLabel, 15, true, false));
        cols.Add(("Remarks", 34, false, true));
        return cols;
    }
    private const int NetWeightIdx = 5, TotalWeightIdx = 6;

    private const float LetterheadTitleHeight = 26f;
    private const float LetterheadTopicHeight = 20f;
    private const float LetterheadMetaHeight = 16f;
    private const float HeaderRowHeight = 24f;
    private const float TotalsRowHeight = 20f;

    private const int EmuPerInch = 914400;
    private const double LogoHeightIn = 0.72;
    private const double LogoWidthIn = 1.33;

    private static byte[]? _logoBytes;
    private static readonly Lock LogoLock = new();

    private byte[] LoadLogo()
    {
        if (_logoBytes is not null) return _logoBytes;
        lock (LogoLock)
        {
            if (_logoBytes is not null) return _logoBytes;
            var path = Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "branding", "logo.png"));
            _logoBytes = File.Exists(path) ? File.ReadAllBytes(path) : [];
            return _logoBytes;
        }
    }

    public XSSFWorkbook Build(
        string title,
        string? saleLabel,
        List<WorksheetRowDto> rows,
        bool excludeUnvalued,
        List<string> extraColumnKeys,
        string valuationLabel = "Valuation",
        string proceedsLabel = "Total Proceeds",
        string sheetName = "Worksheet")
    {
        var columns = BuildColumns(extraColumnKeys, valuationLabel, proceedsLabel);
        var wb = new XSSFWorkbook();
        var ws = wb.CreateSheet(SanitizeSheetName(sheetName));
        var nCols = columns.Count;
        var lastCol = nCols - 1;
        var valuationIdx = 7 + extraColumnKeys.Count;
        var proceedsIdx = valuationIdx + 1;

        var logoBytes = LoadLogo();
        var pictureIdx = logoBytes.Length > 0 ? wb.AddPicture(logoBytes, PictureType.PNG) : (int?)null;

        var styles = BuildStyles(wb);

        // ---- Totals (computed up front — the summary boxes and the totals row both need them) ----
        var totalQty = rows.Sum(r => r.TotalWeight ?? 0);
        var totalNet = rows.Sum(r => r.NetWeight ?? 0);
        var totalValue = rows.Sum(r => (r.Valuation ?? 0) * (r.TotalWeight ?? 0));
        var avgRows = excludeUnvalued ? rows.Where(r => (r.Valuation ?? 0) > 0).ToList() : rows;
        var avgQty = avgRows.Sum(r => r.TotalWeight ?? 0);
        var avgValue = avgRows.Sum(r => (r.Valuation ?? 0) * (r.TotalWeight ?? 0));
        var avg = avgQty > 0 ? avgValue / avgQty : 0;
        var avgLabel = excludeUnvalued ? "Average price (valued lots)" : "Average price";

        var textStartCol = Math.Min(2, lastCol); // column C (0-based 2), matching textStartCol = min(3, nCols) 1-based

        var r = 0;
        void LetterheadRow(string text, ICellStyle style, float height)
        {
            var row = ws.CreateRow(r);
            row.HeightInPoints = height;
            var cell = row.CreateCell(textStartCol);
            cell.SetCellValue(text);
            cell.CellStyle = style;
            if (textStartCol < lastCol) ws.AddMergedRegion(new CellRangeAddress(r, r, textStartCol, lastCol));
            r++;
        }

        var topic = string.IsNullOrWhiteSpace(saleLabel) ? title : $"{title} — {saleLabel}";
        LetterheadRow("ASIA SIYAKA COMMODITIES PLC", styles.LetterheadTitle, LetterheadTitleHeight);
        LetterheadRow(topic, styles.LetterheadTopic, LetterheadTopicHeight);
        LetterheadRow($"Generated {DateTime.UtcNow:dd MMM yyyy, HH:mm} UTC  •  {rows.Count} lots", styles.LetterheadMeta, LetterheadMetaHeight);

        if (pictureIdx.HasValue)
        {
            const double marginIn = 0.1;
            var dx1 = (int)Math.Round(marginIn * EmuPerInch);
            var dy1 = (int)Math.Round(marginIn * EmuPerInch);
            var dx2 = dx1 + (int)Math.Round(LogoWidthIn * EmuPerInch);
            var dy2 = dy1 + (int)Math.Round(LogoHeightIn * EmuPerInch);
            var drawing = ws.CreateDrawingPatriarch();
            var anchor = drawing.CreateAnchor(dx1, dy1, dx2, dy2, 0, 0, 0, 0);
            drawing.CreatePicture(anchor, pictureIdx.Value);
        }

        ws.CreateRow(r).HeightInPoints = 8; // spacer under the letterhead
        r++;

        // ---- Metric summary boxes: Total quantity / Average price / Total value ----
        var summary = new (string Label, decimal Value)[] { ("Total quantity (kg)", totalQty), (avgLabel, avg), ("Total value", totalValue) };
        var labelRow = r;
        var valueRow = r + 1;
        for (var i = 0; i < summary.Length; i++)
        {
            var c0 = i * 3;
            var c1 = c0 + 1;
            if (c1 >= nCols) break;

            var lCell = ws.GetRow(labelRow)?.GetCell(c0) ?? ws.CreateRow(labelRow).CreateCell(c0);
            lCell.SetCellValue(summary[i].Label.ToUpperInvariant());
            lCell.CellStyle = styles.BoxLabel;
            ws.GetRow(labelRow).CreateCell(c1).CellStyle = styles.BoxLabel;
            ws.AddMergedRegion(new CellRangeAddress(labelRow, labelRow, c0, c1));

            var vCell = (ws.GetRow(valueRow) ?? ws.CreateRow(valueRow)).CreateCell(c0);
            vCell.SetCellValue((double)summary[i].Value);
            vCell.CellStyle = styles.BoxValue;
            ws.GetRow(valueRow).CreateCell(c1).CellStyle = styles.BoxValue;
            ws.AddMergedRegion(new CellRangeAddress(valueRow, valueRow, c0, c1));
        }
        ws.GetRow(labelRow).HeightInPoints = 14;
        ws.GetRow(valueRow).HeightInPoints = 21;
        r = valueRow + 1;
        ws.CreateRow(r).HeightInPoints = 8; // spacer
        r++;

        // ---- Table header ----
        var headerRowIdx = r;
        var headerRow = ws.CreateRow(r);
        headerRow.HeightInPoints = HeaderRowHeight;
        for (var c = 0; c < nCols; c++)
        {
            var cell = headerRow.CreateCell(c);
            cell.SetCellValue(columns[c].Header);
            cell.CellStyle = columns[c].Numeric ? styles.HeaderRight : styles.HeaderLeft;
        }
        r++;

        // ---- Data rows — thin gray grid, zebra striping, medium navy frame on the outer
        // left/right edges only (the header and totals rows close the frame top/bottom) ----
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var totalProceeds = (row.Valuation ?? 0) * (row.TotalWeight ?? 0);
            var zebra = i % 2 == 1;
            var values = new List<object?> { row.Broker, row.LotNumber, row.SellingMark, row.Grade, (decimal?)row.Bags, row.NetWeight, row.TotalWeight };
            foreach (var key in extraColumnKeys) values.Add(row.Extra?.GetValueOrDefault(key));
            values.Add(row.ValuationRangeText ?? (object?)row.Valuation);
            values.Add(totalProceeds);
            values.Add(row.Remarks);

            var xr = ws.CreateRow(r);
            for (var c = 0; c < nCols; c++)
            {
                var cell = xr.CreateCell(c);
                var style = styles.DataCell(columns[c].Numeric, c == 0, c == lastCol, zebra);
                var val = values[c];
                if (columns[c].Numeric && val is decimal or double)
                {
                    cell.CellStyle = style;
                    cell.SetCellValue(Convert.ToDouble(val));
                }
                else
                {
                    cell.CellStyle = style;
                    cell.SetCellValue(val?.ToString() ?? "");
                }
            }
            r++;
        }

        // ---- Totals row ----
        var totalsRowIdx = r;
        var totalsRow = ws.CreateRow(r);
        totalsRow.HeightInPoints = TotalsRowHeight;
        var totalsValues = new object?[nCols];
        totalsValues[0] = $"TOTAL — {rows.Count} lots";
        totalsValues[NetWeightIdx] = totalNet;
        totalsValues[TotalWeightIdx] = totalQty;
        totalsValues[valuationIdx] = avg;
        totalsValues[proceedsIdx] = totalValue;
        for (var c = 0; c < nCols; c++)
        {
            var cell = totalsRow.CreateCell(c);
            var style = styles.TotalsCell(columns[c].Numeric, c == 0, c == lastCol);
            cell.CellStyle = style;
            if (totalsValues[c] is decimal or double) cell.SetCellValue(Convert.ToDouble(totalsValues[c]));
            else if (totalsValues[c] is string s) cell.SetCellValue(s);
        }
        r++;

        // ---- Column widths, autofilter, frozen header ----
        for (var c = 0; c < nCols; c++) ws.SetColumnWidth(c, columns[c].Width * 256);
        ws.SetAutoFilter(new CellRangeAddress(headerRowIdx, totalsRowIdx - 1, 0, lastCol));
        ws.CreateFreezePane(0, headerRowIdx + 1);

        return wb;
    }

    private static string SanitizeSheetName(string name)
    {
        var s = name;
        foreach (var c in new[] { '*', '?', ':', '/', '\\', '[', ']' }) s = s.Replace(c, '-');
        return s.Length > 31 ? s[..31] : s;
    }

    private sealed record Styles(
        ICellStyle LetterheadTitle, ICellStyle LetterheadTopic, ICellStyle LetterheadMeta,
        ICellStyle BoxLabel, ICellStyle BoxValue, ICellStyle HeaderLeft, ICellStyle HeaderRight,
        ICellStyle PlainLeft, ICellStyle PlainRight, ICellStyle ZebraLeft, ICellStyle ZebraRight,
        ICellStyle FrameLeftPlain, ICellStyle FrameRightPlain, ICellStyle FrameLeftZebra, ICellStyle FrameRightZebra,
        ICellStyle TotalsLeft, ICellStyle TotalsRight, ICellStyle TotalsFrameLeft, ICellStyle TotalsFrameRight)
    {
        public ICellStyle DataCell(bool numeric, bool isFirstCol, bool isLastCol, bool zebra)
        {
            if (isFirstCol) return zebra ? FrameLeftZebra : FrameLeftPlain;
            if (isLastCol) return zebra ? FrameRightZebra : FrameRightPlain;
            if (zebra) return numeric ? ZebraRight : ZebraLeft;
            return numeric ? PlainRight : PlainLeft;
        }

        public ICellStyle TotalsCell(bool numeric, bool isFirstCol, bool isLastCol)
        {
            if (isFirstCol) return TotalsFrameLeft;
            if (isLastCol) return TotalsFrameRight;
            return numeric ? TotalsRight : TotalsLeft;
        }
    }

    private static Styles BuildStyles(XSSFWorkbook wb)
    {
        // ---- letterhead: plain colored text, no fill — matches the original exactly ----
        var letterheadTitle = wb.CreateCellStyle();
        SetFont(wb, letterheadTitle, NavyRgb, 15, true, false);
        letterheadTitle.VerticalAlignment = VerticalAlignment.Center;

        var letterheadTopic = wb.CreateCellStyle();
        SetFont(wb, letterheadTopic, NavyRgb, 12, true, false);
        letterheadTopic.VerticalAlignment = VerticalAlignment.Center;

        var letterheadMeta = wb.CreateCellStyle();
        SetFont(wb, letterheadMeta, MutedRgb, 9, false, true);
        letterheadMeta.VerticalAlignment = VerticalAlignment.Center;

        // ---- metric summary boxes ----
        var boxLabel = wb.CreateCellStyle();
        SetFont(wb, boxLabel, LabelRgb, 8, true, false);
        boxLabel.VerticalAlignment = VerticalAlignment.Center;
        SetFill((XSSFCellStyle)boxLabel, BoxFillRgb);
        ApplyThinBorder(boxLabel, BoxBorderRgb, top: true, bottom: false, left: true, right: true);

        var boxValue = wb.CreateCellStyle();
        SetFont(wb, boxValue, NavyRgb, 12, true, false);
        boxValue.VerticalAlignment = VerticalAlignment.Center;
        boxValue.DataFormat = wb.CreateDataFormat().GetFormat(NumFmt);
        SetFill((XSSFCellStyle)boxValue, BoxFillRgb);
        ApplyThinBorder(boxValue, BoxBorderRgb, top: false, bottom: true, left: true, right: true);

        // ---- table header — solid navy fill, white bold text ----
        ICellStyle Header(HorizontalAlignment align)
        {
            var style = wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.IsBold = true;
            font.FontHeightInPoints = 10;
            font.Color = IndexedColors.White.Index;
            style.SetFont(font);
            style.Alignment = align;
            style.VerticalAlignment = VerticalAlignment.Center;
            style.WrapText = true;
            SetFill((XSSFCellStyle)style, NavyRgb);
            ApplyMediumBorder(style, NavyRgb, true, true, true, true);
            return style;
        }
        var headerLeft = Header(HorizontalAlignment.Left);
        var headerRight = Header(HorizontalAlignment.Right);

        // ---- data cells: thin gray grid on all sides, medium navy on the outer left/right
        // frame edge, zebra striping every other row ----
        ICellStyle DataStyle(HorizontalAlignment align, bool zebra, bool frameLeft, bool frameRight)
        {
            var style = wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.FontHeightInPoints = 10;
            SetFontColor(font, TextRgb);
            style.SetFont(font);
            style.Alignment = align;
            style.VerticalAlignment = VerticalAlignment.Center;
            style.WrapText = align == HorizontalAlignment.Left;
            if (zebra) SetFill((XSSFCellStyle)style, AltFillRgb);
            style.DataFormat = wb.CreateDataFormat().GetFormat(NumFmt);
            var xssf = (XSSFCellStyle)style;
            xssf.BorderTop = BorderStyle.Thin;
            xssf.SetTopBorderColor(Rgb(GridRgb));
            xssf.BorderBottom = BorderStyle.Thin;
            xssf.SetBottomBorderColor(Rgb(GridRgb));
            xssf.BorderLeft = frameLeft ? BorderStyle.Medium : BorderStyle.Thin;
            xssf.SetLeftBorderColor(Rgb(frameLeft ? NavyRgb : GridRgb));
            xssf.BorderRight = frameRight ? BorderStyle.Medium : BorderStyle.Thin;
            xssf.SetRightBorderColor(Rgb(frameRight ? NavyRgb : GridRgb));
            return style;
        }

        var plainLeft = DataStyle(HorizontalAlignment.Left, false, false, false);
        var plainRight = DataStyle(HorizontalAlignment.Right, false, false, false);
        var zebraLeft = DataStyle(HorizontalAlignment.Left, true, false, false);
        var zebraRight = DataStyle(HorizontalAlignment.Right, true, false, false);
        var frameLeftPlain = DataStyle(HorizontalAlignment.Left, false, true, false);
        var frameRightPlain = DataStyle(HorizontalAlignment.Right, false, false, true);
        var frameLeftZebra = DataStyle(HorizontalAlignment.Left, true, true, false);
        var frameRightZebra = DataStyle(HorizontalAlignment.Right, true, false, true);

        // ---- totals row: bold navy on box-fill, medium border top/bottom (closes the frame) ----
        ICellStyle TotalsStyle(HorizontalAlignment align, bool frameLeft, bool frameRight)
        {
            var style = wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.IsBold = true;
            font.FontHeightInPoints = 10;
            SetFontColor(font, NavyRgb);
            style.SetFont(font);
            style.Alignment = align;
            style.VerticalAlignment = VerticalAlignment.Center;
            style.DataFormat = wb.CreateDataFormat().GetFormat(NumFmt);
            SetFill((XSSFCellStyle)style, BoxFillRgb);
            var xssf = (XSSFCellStyle)style;
            xssf.BorderTop = BorderStyle.Medium;
            xssf.SetTopBorderColor(Rgb(NavyRgb));
            xssf.BorderBottom = BorderStyle.Medium;
            xssf.SetBottomBorderColor(Rgb(NavyRgb));
            xssf.BorderLeft = frameLeft ? BorderStyle.Medium : BorderStyle.Thin;
            xssf.SetLeftBorderColor(Rgb(frameLeft ? NavyRgb : GridRgb));
            xssf.BorderRight = frameRight ? BorderStyle.Medium : BorderStyle.Thin;
            xssf.SetRightBorderColor(Rgb(frameRight ? NavyRgb : GridRgb));
            return style;
        }
        var totalsLeft = TotalsStyle(HorizontalAlignment.Left, false, false);
        var totalsRight = TotalsStyle(HorizontalAlignment.Right, false, false);
        var totalsFrameLeft = TotalsStyle(HorizontalAlignment.Left, true, false);
        var totalsFrameRight = TotalsStyle(HorizontalAlignment.Right, false, true);

        return new Styles(
            letterheadTitle, letterheadTopic, letterheadMeta,
            boxLabel, boxValue, headerLeft, headerRight,
            plainLeft, plainRight, zebraLeft, zebraRight,
            frameLeftPlain, frameRightPlain, frameLeftZebra, frameRightZebra,
            totalsLeft, totalsRight, totalsFrameLeft, totalsFrameRight);
    }

    private static void SetFont(XSSFWorkbook wb, ICellStyle style, byte[] rgb, double size, bool bold, bool italic)
    {
        var font = (XSSFFont)wb.CreateFont();
        font.IsBold = bold;
        font.IsItalic = italic;
        font.FontHeightInPoints = size;
        font.SetColor(Rgb(rgb));
        style.SetFont(font);
    }

    private static void SetFontColor(IFont font, byte[] rgb) => ((XSSFFont)font).SetColor(Rgb(rgb));

    private static XSSFColor Rgb(byte[] rgb)
    {
        var color = new XSSFColor();
        color.RGB = rgb;
        return color;
    }

    private static void SetFill(XSSFCellStyle style, byte[] rgb)
    {
        style.FillPattern = FillPattern.SolidForeground;
        style.SetFillForegroundColor(Rgb(rgb));
    }

    private static void ApplyThinBorder(ICellStyle style, byte[] rgb, bool top, bool bottom, bool left, bool right)
    {
        var xssf = (XSSFCellStyle)style;
        if (top) { xssf.BorderTop = BorderStyle.Thin; xssf.SetTopBorderColor(Rgb(rgb)); }
        if (bottom) { xssf.BorderBottom = BorderStyle.Thin; xssf.SetBottomBorderColor(Rgb(rgb)); }
        if (left) { xssf.BorderLeft = BorderStyle.Thin; xssf.SetLeftBorderColor(Rgb(rgb)); }
        if (right) { xssf.BorderRight = BorderStyle.Thin; xssf.SetRightBorderColor(Rgb(rgb)); }
    }

    private static void ApplyMediumBorder(ICellStyle style, byte[] rgb, bool top, bool bottom, bool left, bool right)
    {
        var xssf = (XSSFCellStyle)style;
        if (top) { xssf.BorderTop = BorderStyle.Medium; xssf.SetTopBorderColor(Rgb(rgb)); }
        if (bottom) { xssf.BorderBottom = BorderStyle.Medium; xssf.SetBottomBorderColor(Rgb(rgb)); }
        if (left) { xssf.BorderLeft = BorderStyle.Medium; xssf.SetLeftBorderColor(Rgb(rgb)); }
        if (right) { xssf.BorderRight = BorderStyle.Medium; xssf.SetRightBorderColor(Rgb(rgb)); }
    }
}
