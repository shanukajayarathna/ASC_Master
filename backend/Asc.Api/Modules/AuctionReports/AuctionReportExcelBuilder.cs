using Asc.Api.Services;
using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;
using static Asc.Api.Services.ExcelStyleTheme;

namespace Asc.Api.Modules.AuctionReports;

/// <summary>
/// Styled workbook writer for the Combined Report / Top Prices family — a line-for-line port of
/// report-common.js's addSheetToWorkbook/writeBlockAtColumn (ExcelJS) onto NPOI: same colors,
/// same borders, same embedded company logo, same letterhead layout, same spacer rows between
/// grades. One worksheet per AuctionReportSheetDto, blocks stacked vertically (never side by
/// side) so every sheet still fits at 100% on A4 portrait, exactly as the original was
/// redesigned to do.
///
/// The embedded logo needs NPOI's XSSF drawing/picture API (CreateDrawingPatriarch/
/// CreatePicture), which pulls in a SkiaSharp font-metrics dependency — SkiaSharp is therefore
/// a real dependency of this class specifically (added to Asc.Api.csproj), even though the rest
/// of this codebase deliberately avoids NPOI code paths that need it (see
/// CatalogueImportService.cs's own comment about DataFormatter for why).
/// </summary>
public class AuctionReportExcelBuilder(IWebHostEnvironment env)
{
    // Colors (NavyRgb/HeaderBlueRgb/HighlightGreenRgb/MutedGrayRgb/MetaTintRgb) come from the
    // shared ExcelStyleTheme (statically imported above) — exact values from report-common.js's
    // BOLD_BORDER/block-title/header fills/HIGHLIGHT_GREEN, reproduced there rather than this
    // app's own black+gold export palette since the goal is matching the original bulletin.

    // Row height and font sizes are deliberately generous — these sheets get printed and read
    // across a desk, so legibility beats fitting more on a page (report-common.js's own words).
    private const float TableRowHeight = 24f;
    private const float BlockTitleRowHeight = 26f;
    private const float LetterheadTitleRowHeight = 34f;
    private const float LetterheadSubtitleRowHeight = 24f;
    private const float LetterheadMetaRowHeight = 18f;

    // Logo anchor size — fixed at exactly 0.72" tall x 1.33" wide (914400 EMU per inch),
    // independent of the source image's own pixel dimensions/aspect ratio.
    private const int EmuPerInch = 914400;
    private const double LogoHeightIn = 0.72;
    private const double LogoWidthIn = 1.33;

    private static byte[]? _logoBytes;
    private static readonly Lock LogoLock = new();

    /// <summary>Same logo report-common.js embeds (AVG and Top Prize/logo.png), copied to
    /// data/branding — the shared file-backed data root every other store in this app already
    /// reads from (SaleFileStore's SalesDir, LocalDocumentStore, LocalLotMediaStore).</summary>
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

    /// <summary>Adds the logo's image data to the workbook once; each sheet then creates its own
    /// IPicture pointing at this same index, so the bytes aren't duplicated per sheet.</summary>
    private int? EmbedLogo(XSSFWorkbook wb)
    {
        var bytes = LoadLogo();
        return bytes.Length > 0 ? wb.AddPicture(bytes, PictureType.PNG) : null;
    }

    public XSSFWorkbook Build(AuctionReportDto report)
    {
        var wb = new XSSFWorkbook();
        var styles = BuildStyles(wb);
        var pictureIdx = EmbedLogo(wb);
        foreach (var sheetDto in report.Sheets)
        {
            var ws = wb.CreateSheet(UniqueSheetName(wb, sheetDto.Title));
            WriteSheet(ws, styles, pictureIdx, report.SourceName, report.Title, sheetDto);
        }
        return wb;
    }

    public XSSFWorkbook Build(CombinedReportDto combined)
    {
        var wb = new XSSFWorkbook();
        var styles = BuildStyles(wb);
        var pictureIdx = EmbedLogo(wb);
        foreach (var report in combined.Reports)
        {
            foreach (var sheetDto in report.Sheets)
            {
                var ws = wb.CreateSheet(UniqueSheetName(wb, sheetDto.Title));
                WriteSheet(ws, styles, pictureIdx, combined.SourceName, report.Title, sheetDto);
            }
        }
        return wb;
    }

    private static string UniqueSheetName(XSSFWorkbook wb, string title)
    {
        var baseName = SanitizeSheetName(title);
        if (baseName.Length > 28) baseName = baseName[..28];
        var name = baseName;
        var suffix = 2;
        while (wb.GetSheet(name) is not null) name = $"{baseName} {suffix++}";
        return name;
    }

    private static string SanitizeSheetName(string name)
    {
        var s = name;
        foreach (var c in new[] { '*', '?', ':', '/', '\\', '[', ']' }) s = s.Replace(c, '-');
        return s;
    }

    private sealed record Styles(
        ICellStyle LetterheadTitle, ICellStyle LetterheadSubtitle, ICellStyle LetterheadMeta,
        ICellStyle BlockTitle, ICellStyle Header, ICellStyle Cell, ICellStyle CellHighlight,
        ICellStyle Currency, ICellStyle CurrencyHighlight, ICellStyle Spacer, ICellStyle Empty);

    private static Styles BuildStyles(XSSFWorkbook wb)
    {
        // ---- letterhead — solid navy/blue banners (same theme as the block-title/header bars
        // below), white bold text, so the top of the sheet reads as one deliberate masthead
        // rather than plain colored text floating on a blank background.
        var letterheadTitleStyle = wb.CreateCellStyle();
        var letterheadTitleFont = wb.CreateFont();
        letterheadTitleFont.IsBold = true;
        letterheadTitleFont.FontHeightInPoints = 16;
        letterheadTitleFont.Color = IndexedColors.White.Index;
        letterheadTitleStyle.SetFont(letterheadTitleFont);
        CenterBoth(letterheadTitleStyle);
        ApplyBoxBorder(letterheadTitleStyle, NavyRgb);
        SetSolidFill((XSSFCellStyle)letterheadTitleStyle, NavyRgb);

        var letterheadSubtitleStyle = wb.CreateCellStyle();
        var letterheadSubtitleFont = wb.CreateFont();
        letterheadSubtitleFont.IsBold = true;
        letterheadSubtitleFont.FontHeightInPoints = 12;
        letterheadSubtitleFont.Color = IndexedColors.White.Index;
        letterheadSubtitleStyle.SetFont(letterheadSubtitleFont);
        CenterBoth(letterheadSubtitleStyle);
        ApplyBoxBorder(letterheadSubtitleStyle, NavyRgb);
        SetSolidFill((XSSFCellStyle)letterheadSubtitleStyle, HeaderBlueRgb);

        var letterheadMetaStyle = wb.CreateCellStyle();
        CenterBoth(letterheadMetaStyle);
        ApplyBoxBorder(letterheadMetaStyle, NavyRgb);
        SetSolidFill((XSSFCellStyle)letterheadMetaStyle, MetaTintRgb);
        SetFontColor(wb, letterheadMetaStyle, MutedGrayRgb, 9, false, true);

        // ---- per-block title bar and header row — solid navy / blue fill, white bold text.
        var blockTitleStyle = wb.CreateCellStyle();
        var blockTitleFont = wb.CreateFont();
        blockTitleFont.IsBold = true;
        blockTitleFont.FontHeightInPoints = 14;
        blockTitleFont.Color = IndexedColors.White.Index;
        blockTitleStyle.SetFont(blockTitleFont);
        CenterBoth(blockTitleStyle);
        ApplyBoxBorder(blockTitleStyle, NavyRgb);
        SetSolidFill((XSSFCellStyle)blockTitleStyle, NavyRgb);

        var boxHeaderStyle = wb.CreateCellStyle();
        var boxHeaderFont = wb.CreateFont();
        boxHeaderFont.IsBold = true;
        boxHeaderFont.FontHeightInPoints = 12;
        boxHeaderFont.Color = IndexedColors.White.Index;
        boxHeaderStyle.SetFont(boxHeaderFont);
        CenterBoth(boxHeaderStyle);
        boxHeaderStyle.WrapText = true;
        ApplyBoxBorder(boxHeaderStyle, NavyRgb);
        SetSolidFill((XSSFCellStyle)boxHeaderStyle, HeaderBlueRgb);

        // ---- body cells ----
        var bodyFont = wb.CreateFont();
        bodyFont.FontHeightInPoints = 12;

        var boxCellStyle = wb.CreateCellStyle();
        boxCellStyle.SetFont(bodyFont);
        CenterBoth(boxCellStyle);
        ApplyBoxBorder(boxCellStyle, NavyRgb);

        var boxCurrencyStyle = wb.CreateCellStyle();
        boxCurrencyStyle.SetFont(bodyFont);
        CenterBoth(boxCurrencyStyle);
        boxCurrencyStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0.00");
        ApplyBoxBorder(boxCurrencyStyle, NavyRgb);

        var spacerStyle = wb.CreateCellStyle();
        ApplyBoxBorder(spacerStyle, NavyRgb);

        var emptyStyle = wb.CreateCellStyle();
        CenterBoth(emptyStyle);
        SetFontColor(wb, emptyStyle, MutedGrayRgb, 12, false, true);

        var highlightFont = wb.CreateFont();
        highlightFont.IsBold = true;
        highlightFont.FontHeightInPoints = 12;

        var highlightCellStyle = wb.CreateCellStyle();
        highlightCellStyle.CloneStyleFrom(boxCellStyle);
        highlightCellStyle.SetFont(highlightFont);
        SetSolidFill((XSSFCellStyle)highlightCellStyle, HighlightGreenRgb);

        var highlightCurrencyStyle = wb.CreateCellStyle();
        highlightCurrencyStyle.CloneStyleFrom(boxCurrencyStyle);
        highlightCurrencyStyle.SetFont(highlightFont);
        SetSolidFill((XSSFCellStyle)highlightCurrencyStyle, HighlightGreenRgb);

        return new Styles(
            letterheadTitleStyle, letterheadSubtitleStyle, letterheadMetaStyle,
            blockTitleStyle, boxHeaderStyle, boxCellStyle, highlightCellStyle,
            boxCurrencyStyle, highlightCurrencyStyle, spacerStyle, emptyStyle);
    }

    private static void WriteSheet(ISheet ws, Styles styles, int? pictureIdx, string sourceName, string reportTitle, AuctionReportSheetDto sheetDto)
    {
        // No Rank column: rows are already printed in rank order (highest price first), same
        // as report-common.js's blockHeaders() — the number would add nothing the ordering
        // doesn't already say, and costs a column of width on every table.
        var headers = sheetDto.IncludeElevation
            ? new[] { "Broker", "Selling Mark", "Grade", "Sub Elevation", "Price", "Buyer" }
            : new[] { "Broker", "Selling Mark", "Grade", "Price", "Buyer" };
        var priceCol = sheetDto.IncludeElevation ? 4 : 3;
        var lastCol = headers.Length - 1;

        // Letterhead text starts at column C (0-based col 2) exactly like the original, so the
        // logo floating top-left over rows 0-2 never overlaps the company name/title text.
        var textStartCol = Math.Min(2, lastCol);

        void LetterheadRow(int row, string text, ICellStyle style, float height)
        {
            var r = ws.CreateRow(row);
            r.HeightInPoints = height;
            for (var c = 0; c <= lastCol; c++)
            {
                var cell = r.CreateCell(c);
                cell.CellStyle = style;
                if (c == textStartCol) cell.SetCellValue(text);
            }
            if (textStartCol < lastCol) ws.AddMergedRegion(new CellRangeAddress(row, row, textStartCol, lastCol));
        }

        LetterheadRow(0, "ASIA SIYAKA COMMODITIES PLC", styles.LetterheadTitle, LetterheadTitleRowHeight);
        LetterheadRow(1, $"{reportTitle} — {sheetDto.Title} — {sourceName}", styles.LetterheadSubtitle, LetterheadSubtitleRowHeight);
        LetterheadRow(2, $"Generated {DateTime.UtcNow:dd MMM yyyy, HH:mm} UTC", styles.LetterheadMeta, LetterheadMetaRowHeight);
        var rowIdx = 4; // one blank row after the letterhead, matching the original's cursorRow = 5 (1-based)

        if (pictureIdx.HasValue)
        {
            // Anchored entirely within cell (0,0) via explicit EMU offsets (914400 per inch)
            // rather than spanning multiple columns/rows — sizing this way is independent of
            // column-width/row-height settings and gives an exact, reproducible physical size:
            // 0.72" tall x 1.33" wide, regardless of the source image's own pixel dimensions.
            // Comfortably margined and vertically centered within the full letterhead block
            // (title+subtitle+meta rows) rather than pinned into the top-left corner.
            const double leftMarginIn = 0.22;
            var letterheadHeightIn = (LetterheadTitleRowHeight + LetterheadSubtitleRowHeight + LetterheadMetaRowHeight) / 72.0;
            var topMarginIn = Math.Max(0.08, (letterheadHeightIn - LogoHeightIn) / 2);

            var dx1 = (int)Math.Round(leftMarginIn * EmuPerInch);
            var dy1 = (int)Math.Round(topMarginIn * EmuPerInch);
            var dx2 = dx1 + (int)Math.Round(LogoWidthIn * EmuPerInch);
            var dy2 = dy1 + (int)Math.Round(LogoHeightIn * EmuPerInch);

            var drawing = ws.CreateDrawingPatriarch();
            var anchor = drawing.CreateAnchor(dx1, dy1, dx2, dy2, 0, 0, 0, 0);
            drawing.CreatePicture(anchor, pictureIdx.Value);
        }

        foreach (var block in sheetDto.Blocks)
        {
            var titleRow = ws.CreateRow(rowIdx);
            titleRow.HeightInPoints = BlockTitleRowHeight;
            for (var c = 0; c <= lastCol; c++)
            {
                var cell = titleRow.CreateCell(c);
                cell.CellStyle = styles.BlockTitle;
                if (c == 0) cell.SetCellValue(block.Title);
            }
            if (lastCol > 0) ws.AddMergedRegion(new CellRangeAddress(rowIdx, rowIdx, 0, lastCol));
            rowIdx++;

            if (block.Grades.Count == 0)
            {
                var cell = ws.CreateRow(rowIdx++).CreateCell(0);
                cell.SetCellValue("No matching data for this section.");
                cell.CellStyle = styles.Empty;
                continue;
            }

            var headerRow = ws.CreateRow(rowIdx++);
            headerRow.HeightInPoints = TableRowHeight;
            for (var c = 0; c < headers.Length; c++)
            {
                var cell = headerRow.CreateCell(c);
                cell.SetCellValue(headers[c]);
                cell.CellStyle = styles.Header;
            }

            var gradeIdx = 0;
            foreach (var grade in block.Grades)
            {
                // Two empty (bordered) spacer rows between grades — the grade is already
                // visible in its own column, so no per-grade sub-heading is needed; this is
                // purely a print-legibility separator between one grade's rows and the next.
                if (gradeIdx > 0)
                {
                    for (var spacer = 0; spacer < 2; spacer++)
                    {
                        var spacerRow = ws.CreateRow(rowIdx++);
                        spacerRow.HeightInPoints = TableRowHeight;
                        for (var c = 0; c <= lastCol; c++) spacerRow.CreateCell(c).CellStyle = styles.Spacer;
                    }
                }
                gradeIdx++;

                foreach (var item in grade.Rows)
                {
                    var cellStyle = item.IsOurs ? styles.CellHighlight : styles.Cell;
                    var currencyStyle = item.IsOurs ? styles.CurrencyHighlight : styles.Currency;

                    var values = sheetDto.IncludeElevation
                        ? new object[] { item.Broker, item.SellingMark, item.Grade, item.SubElevation ?? "", "", item.Buyer ?? "" }
                        : new object[] { item.Broker, item.SellingMark, item.Grade, "", item.Buyer ?? "" };

                    var row = ws.CreateRow(rowIdx++);
                    row.HeightInPoints = TableRowHeight;
                    for (var c = 0; c < values.Length; c++)
                    {
                        var cell = row.CreateCell(c);
                        if (c == priceCol)
                        {
                            cell.CellStyle = currencyStyle;
                            cell.SetCellValue((double)item.Price);
                        }
                        else
                        {
                            cell.CellStyle = cellStyle;
                            cell.SetCellValue(values[c].ToString());
                        }
                    }
                }
            }
            rowIdx++; // spacer between blocks
        }

        for (var c = 0; c <= lastCol; c++) ws.SetColumnWidth(c, 18 * 256);
    }
}
