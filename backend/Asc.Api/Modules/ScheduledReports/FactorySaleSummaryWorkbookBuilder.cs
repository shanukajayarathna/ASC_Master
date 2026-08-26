using Asc.Api.Modules.Msl;
using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// Renders FactorySaleSummaryReportJob's aggregated cells into the two-sheet workbook layout
/// Anjula Sir's own "SALE NO:33" sample used: one row per group (estate, or plantation-group
/// owner), one 3-column QTY/AVG/UN SLOD block per broker active in the sale, and a TOTAL block
/// summed across every broker. Uses NPOI (XSSFWorkbook), the same library and cell-style
/// conventions as MslExcelExportService.
/// </summary>
internal static class FactorySaleSummaryWorkbookBuilder
{
    public static byte[] Build(int saleNo, int year, DateTime saleDate, List<FactorySaleSummaryReportJob.Cell> cells, MslReferenceService reference)
    {
        var wb = new XSSFWorkbook();

        WriteSheet(wb, "Estate-wise", saleNo, saleDate, GroupRows(cells, c => string.IsNullOrWhiteSpace(c.Estate) ? "(Unknown estate)" : c.Estate));
        WriteSheet(wb, "Owner-wise", saleNo, saleDate, GroupRows(cells, c => ResolveOwnerGroup(c.Factory, reference)));

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        return ms.ToArray();
    }

    private static string ResolveOwnerGroup(string factory, MslReferenceService reference)
    {
        if (string.IsNullOrWhiteSpace(factory)) return "(Unclassified)";
        var normalized = MslFilteredAnalyticsController.NormalizeFactory(factory);
        return reference.ByFactory.TryGetValue(normalized, out var r) && !string.IsNullOrWhiteSpace(r.Group)
            ? r.Group!
            : "(Unclassified)";
    }

    private sealed record BrokerTotals(decimal Qty, decimal Value, decimal UnsoldQty)
    {
        public decimal? Avg => Qty > 0 ? Math.Round(Value / Qty, 2) : null;
    }

    private sealed record GroupRow(string Label, Dictionary<string, BrokerTotals> ByBroker, decimal TotalQty, decimal TotalUnsold, decimal? TotalAvg);

    private static List<GroupRow> GroupRows(List<FactorySaleSummaryReportJob.Cell> cells, Func<FactorySaleSummaryReportJob.Cell, string> keySelector)
    {
        return cells
            .GroupBy(keySelector)
            .Select(g =>
            {
                var byBroker = g.GroupBy(c => c.Broker).ToDictionary(
                    bg => bg.Key,
                    bg => new BrokerTotals(bg.Sum(c => c.SoldQty), bg.Sum(c => c.SoldValue), bg.Sum(c => c.UnsoldQty)));
                var totalQty = byBroker.Values.Sum(v => v.Qty);
                var totalVal = byBroker.Values.Sum(v => v.Value);
                var totalUnsold = byBroker.Values.Sum(v => v.UnsoldQty);
                return new GroupRow(g.Key, byBroker, totalQty, totalUnsold, totalQty > 0 ? Math.Round(totalVal / totalQty, 2) : null);
            })
            .OrderByDescending(r => r.TotalQty)
            .ToList();
    }

    private static void WriteSheet(XSSFWorkbook wb, string sheetName, int saleNo, DateTime saleDate, List<GroupRow> rows)
    {
        var ws = wb.CreateSheet(sheetName);

        // Broker column order: busiest broker (by total qty across the sale) first, TOTAL always last.
        var brokers = rows
            .SelectMany(r => r.ByBroker.Keys)
            .Distinct()
            .OrderByDescending(b => rows.Sum(r => r.ByBroker.TryGetValue(b, out var v) ? v.Qty : 0))
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

        var avgStyle = wb.CreateCellStyle();
        avgStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0.00");
        avgStyle.BorderTop = BorderStyle.Thin;
        avgStyle.BorderBottom = BorderStyle.Thin;
        avgStyle.BorderLeft = BorderStyle.Thin;
        avgStyle.BorderRight = BorderStyle.Thin;

        var totalLabelStyle = wb.CreateCellStyle();
        var totalFont = wb.CreateFont();
        totalFont.IsBold = true;
        totalLabelStyle.SetFont(totalFont);
        totalLabelStyle.BorderTop = BorderStyle.Thin;
        totalLabelStyle.BorderBottom = BorderStyle.Thin;
        totalLabelStyle.BorderLeft = BorderStyle.Thin;
        totalLabelStyle.BorderRight = BorderStyle.Thin;

        var totalQtyStyle = wb.CreateCellStyle();
        totalQtyStyle.CloneStyleFrom(qtyStyle);
        totalQtyStyle.SetFont(totalFont);
        var totalAvgStyle = wb.CreateCellStyle();
        totalAvgStyle.CloneStyleFrom(avgStyle);
        totalAvgStyle.SetFont(totalFont);

        const int labelCol = 0;
        var totalCols = 1 + brokers.Count * 3 + 3; // FACTORY + (QTY/AVG/UN SLOD per broker) + TOTAL block
        var lastCol = totalCols - 1;

        // Row 0: title, merged across the full width.
        var titleRow = ws.CreateRow(0);
        var titleCell = titleRow.CreateCell(labelCol);
        titleCell.SetCellValue($"SALE NO:{saleNo}   ({sheetName} — {saleDate:dd MMM yyyy})");
        titleCell.CellStyle = titleStyle;
        ws.AddMergedRegion(new CellRangeAddress(0, 0, labelCol, lastCol));

        // Rows 1-2: FACTORY (vertically merged) | one merged broker-code header per broker | TOTAL.
        var groupRow = ws.CreateRow(1);
        var subHeaderRow = ws.CreateRow(2);

        var factoryHeaderCell = groupRow.CreateCell(labelCol);
        factoryHeaderCell.SetCellValue("FACTORY");
        factoryHeaderCell.CellStyle = groupHeaderStyle;
        subHeaderRow.CreateCell(labelCol).CellStyle = groupHeaderStyle;
        ws.AddMergedRegion(new CellRangeAddress(1, 2, labelCol, labelCol));

        var col = labelCol + 1;
        void WriteGroupBlock(string label)
        {
            var headerCell = groupRow.CreateCell(col);
            headerCell.SetCellValue(label);
            headerCell.CellStyle = groupHeaderStyle;
            ws.AddMergedRegion(new CellRangeAddress(1, 1, col, col + 2));

            string[] subLabels = ["QTY", "AVG", "UN SLOD"];
            for (var i = 0; i < 3; i++)
            {
                var c = subHeaderRow.CreateCell(col + i);
                c.SetCellValue(subLabels[i]);
                c.CellStyle = colHeaderStyle;
            }
            col += 3;
        }

        foreach (var broker in brokers) WriteGroupBlock(broker);
        WriteGroupBlock("TOTAL");

        // Data rows.
        var r = 3;
        foreach (var row in rows)
        {
            var dataRow = ws.CreateRow(r++);
            dataRow.CreateCell(labelCol).SetCellValue(row.Label);
            dataRow.GetCell(labelCol).CellStyle = labelStyle;

            var c = labelCol + 1;
            void WriteCell(decimal qty, decimal? avg, decimal unsold, bool isTotal)
            {
                var qtyCell = dataRow.CreateCell(c);
                var avgCell = dataRow.CreateCell(c + 1);
                var unsoldCell = dataRow.CreateCell(c + 2);
                qtyCell.CellStyle = isTotal ? totalQtyStyle : qtyStyle;
                avgCell.CellStyle = isTotal ? totalAvgStyle : avgStyle;
                unsoldCell.CellStyle = isTotal ? totalQtyStyle : qtyStyle;
                if (qty > 0) qtyCell.SetCellValue((double)qty);
                if (avg is { } a) avgCell.SetCellValue((double)a);
                if (unsold > 0) unsoldCell.SetCellValue((double)unsold);
                c += 3;
            }

            foreach (var broker in brokers)
            {
                var t = row.ByBroker.GetValueOrDefault(broker);
                WriteCell(t?.Qty ?? 0, t?.Avg, t?.UnsoldQty ?? 0, isTotal: false);
            }
            WriteCell(row.TotalQty, row.TotalAvg, row.TotalUnsold, isTotal: true);
        }

        ws.SetColumnWidth(labelCol, 28 * 256);
        for (var i = labelCol + 1; i <= lastCol; i++) ws.SetColumnWidth(i, 11 * 256);
    }
}
