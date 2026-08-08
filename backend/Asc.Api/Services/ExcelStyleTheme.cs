using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Services;

/// <summary>
/// Shared NPOI/XSSF style helpers for the navy/blue "Asia Siyaka" report theme — originally
/// built for AuctionReportExcelBuilder, reused by WorksheetExcelBuilder so both exports stay
/// visually consistent and a palette tweak only ever needs to happen in one place.
/// </summary>
internal static class ExcelStyleTheme
{
    public static readonly byte[] NavyRgb = [0x0B, 0x25, 0x45];
    public static readonly byte[] HeaderBlueRgb = [0x0F, 0x4C, 0x81];
    public static readonly byte[] HighlightGreenRgb = [0xC6, 0xEF, 0xCE];
    public static readonly byte[] MutedGrayRgb = [0x8A, 0x97, 0xAC];
    public static readonly byte[] MetaTintRgb = [0xE8, 0xEC, 0xF1];

    public static XSSFColor Rgb(byte[] rgb)
    {
        var color = new XSSFColor();
        color.RGB = rgb;
        return color;
    }

    public static void CenterBoth(ICellStyle style)
    {
        style.Alignment = HorizontalAlignment.Center;
        style.VerticalAlignment = VerticalAlignment.Center;
    }

    public static void SetSolidFill(XSSFCellStyle style, byte[] rgb)
    {
        style.FillPattern = FillPattern.SolidForeground;
        style.SetFillForegroundColor(Rgb(rgb));
    }

    // Medium-weight, colored box border on all four sides.
    public static void ApplyBoxBorder(ICellStyle style, byte[] rgb)
    {
        style.BorderTop = BorderStyle.Medium;
        style.BorderBottom = BorderStyle.Medium;
        style.BorderLeft = BorderStyle.Medium;
        style.BorderRight = BorderStyle.Medium;
        var xssf = (XSSFCellStyle)style;
        xssf.SetTopBorderColor(Rgb(rgb));
        xssf.SetBottomBorderColor(Rgb(rgb));
        xssf.SetLeftBorderColor(Rgb(rgb));
        xssf.SetRightBorderColor(Rgb(rgb));
    }

    public static void SetFontColor(XSSFWorkbook wb, ICellStyle style, byte[] rgb, double size, bool bold, bool italic)
    {
        var font = (XSSFFont)wb.CreateFont();
        font.IsBold = bold;
        font.IsItalic = italic;
        font.FontHeightInPoints = size;
        font.SetColor(Rgb(rgb));
        style.SetFont(font);
    }
}
