using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Renders SharedMarkCatalogueService's aggregated rows into a two-sheet workbook — "Low
/// Grown" and "High & Medium Grown" — mirroring the shape of the user's hand-built
/// "Sharing Mark Catalogued Summary" tracker/PDFs: one row per Selling Mark (never merged
/// with another, even a same-estate sibling brand — see SharedMarkCatalogueService's own
/// doc comment for why), one 3-column Sale/MTD/YTD block per broker active that sale,
/// busiest broker first. Uses NPOI (XSSFWorkbook), the same library and cell-style
/// conventions as FactorySaleSummaryWorkbookBuilder.
/// </summary>
internal static class SharedMarkCatalogueWorkbookBuilder
{
    public static byte[] Build(SharedMarkCatalogueResult result)
    {
        var wb = new XSSFWorkbook();
        WriteSheet(wb, "Low Grown", result, r => r.ElevationBucket == "Low Grown");
        WriteSheet(wb, "High & Medium Grown", result, r => r.ElevationBucket != "Low Grown");

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        return ms.ToArray();
    }

    private static void WriteSheet(XSSFWorkbook wb, string sheetName, SharedMarkCatalogueResult result, Func<SharedMarkCatalogueRow, bool> include)
    {
        var ws = wb.CreateSheet(sheetName);
        var rows = result.Rows.Where(include).ToList();

        // Busiest broker (by total sale qty across this sheet) first.
        var brokers = rows
            .SelectMany(r => r.SaleQtyByBroker.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(b => rows.Sum(r => r.SaleQtyByBroker.GetValueOrDefault(b)))
            .ToList();

        var titleStyle = wb.CreateCellStyle();
        var titleFont = wb.CreateFont();
        titleFont.IsBold = true;
        titleFont.FontHeightInPoints = 14;
        titleStyle.SetFont(titleFont);
        titleStyle.Alignment = HorizontalAlignment.Center;

        var groupHeaderStyle = wb.CreateCellStyle();
        var groupHeaderFont = wb.CreateFont();
        groupHeaderFont.IsBold = true;
        groupHeaderStyle.SetFont(groupHeaderFont);
        groupHeaderStyle.Alignment = HorizontalAlignment.Center;
        groupHeaderStyle.VerticalAlignment = VerticalAlignment.Center;
        groupHeaderStyle.FillForegroundColor = NPOI.HSSF.Util.HSSFColor.Grey25Percent.Index;
        groupHeaderStyle.FillPattern = FillPattern.SolidForeground;

        var colHeaderStyle = wb.CreateCellStyle();
        var colHeaderFont = wb.CreateFont();
        colHeaderFont.IsBold = true;
        colHeaderStyle.SetFont(colHeaderFont);
        colHeaderStyle.Alignment = HorizontalAlignment.Center;
        colHeaderStyle.BorderTop = BorderStyle.Thin;
        colHeaderStyle.BorderBottom = BorderStyle.Thin;
        colHeaderStyle.BorderLeft = BorderStyle.Thin;
        colHeaderStyle.BorderRight = BorderStyle.Thin;

        var labelStyle = wb.CreateCellStyle();
        labelStyle.BorderTop = BorderStyle.Thin;
        labelStyle.BorderBottom = BorderStyle.Thin;
        labelStyle.BorderLeft = BorderStyle.Thin;
        labelStyle.BorderRight = BorderStyle.Thin;

        var qtyStyle = wb.CreateCellStyle();
        qtyStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0");
        qtyStyle.BorderTop = BorderStyle.Thin;
        qtyStyle.BorderBottom = BorderStyle.Thin;
        qtyStyle.BorderLeft = BorderStyle.Thin;
        qtyStyle.BorderRight = BorderStyle.Thin;

        const int labelCol = 0;
        var totalCols = 1 + brokers.Count * 3;
        var lastCol = Math.Max(totalCols - 1, labelCol);

        var titleRow = ws.CreateRow(0);
        var titleCell = titleRow.CreateCell(labelCol);
        titleCell.SetCellValue($"Sharing Mark Catalogued Summary - {sheetName} - Sale {result.SaleNo}/{result.SaleYear} ({result.SaleDate:dd MMM yyyy})");
        titleCell.CellStyle = titleStyle;
        ws.AddMergedRegion(new CellRangeAddress(0, 0, labelCol, lastCol));

        var groupRow = ws.CreateRow(1);
        var subHeaderRow = ws.CreateRow(2);

        var estateHeaderCell = groupRow.CreateCell(labelCol);
        estateHeaderCell.SetCellValue("SELLING MARK");
        estateHeaderCell.CellStyle = groupHeaderStyle;
        subHeaderRow.CreateCell(labelCol).CellStyle = groupHeaderStyle;
        ws.AddMergedRegion(new CellRangeAddress(1, 2, labelCol, labelCol));

        var col = labelCol + 1;
        foreach (var broker in brokers)
        {
            var headerCell = groupRow.CreateCell(col);
            headerCell.SetCellValue(broker);
            headerCell.CellStyle = groupHeaderStyle;
            ws.AddMergedRegion(new CellRangeAddress(1, 1, col, col + 2));

            string[] subLabels = ["SALE", "MTD", "YTD"];
            for (var i = 0; i < 3; i++)
            {
                var c = subHeaderRow.CreateCell(col + i);
                c.SetCellValue(subLabels[i]);
                c.CellStyle = colHeaderStyle;
            }
            col += 3;
        }

        var r = 3;
        foreach (var row in rows.OrderBy(x => x.EstateName, StringComparer.OrdinalIgnoreCase))
        {
            var dataRow = ws.CreateRow(r++);
            var labelCell = dataRow.CreateCell(labelCol);
            labelCell.SetCellValue(row.EstateName);
            labelCell.CellStyle = labelStyle;

            var c = labelCol + 1;
            foreach (var broker in brokers)
            {
                var sale = row.SaleQtyByBroker.GetValueOrDefault(broker);
                var mtd = row.MonthQtyByBroker.GetValueOrDefault(broker);
                var ytd = row.YearQtyByBroker.GetValueOrDefault(broker);

                var saleCell = dataRow.CreateCell(c);
                var mtdCell = dataRow.CreateCell(c + 1);
                var ytdCell = dataRow.CreateCell(c + 2);
                saleCell.CellStyle = qtyStyle;
                mtdCell.CellStyle = qtyStyle;
                ytdCell.CellStyle = qtyStyle;
                if (sale > 0) saleCell.SetCellValue((double)sale);
                if (mtd > 0) mtdCell.SetCellValue((double)mtd);
                if (ytd > 0) ytdCell.SetCellValue((double)ytd);
                c += 3;
            }
        }

        ws.SetColumnWidth(labelCol, 30 * 256);
        for (var i = labelCol + 1; i <= lastCol; i++) ws.SetColumnWidth(i, 11 * 256);
    }
}
