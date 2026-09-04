using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Renders one elevation bucket's rows into a single-sheet workbook matching the exact
/// layout of the user's original hand-built PDFs: a title row, a "Sale No & Date" row (one
/// column per sale number in the display month, including future weeks with no data yet,
/// plus a running "Month" total and — Low Grown only — a running "Year" total), a
/// "Factory Name" row underneath it with each week's actual date, then one block per
/// Selling Mark ordered by Trade Mark/Factory code (not name — see
/// SharedMarkCatalogueRow.Code): a bold name row followed by one row per broker with that
/// broker's per-week catalogued quantity, ASC first. A week that hasn't happened yet is left
/// genuinely blank; a week that has happened with a real recorded quantity of zero shows an
/// explicit "0" on a red fill — see WriteQtyCell's own comment for why those are kept
/// distinct. Two calls to BuildBucket (one per elevation bucket) produce the two separate
/// files the original report always was — see SharedMarkCatalogueGenerationService, which
/// saves each as its own SavedReport. Uses NPOI (XSSFWorkbook), the same library and
/// cell-style conventions as FactorySaleSummaryWorkbookBuilder.
/// </summary>
internal static class SharedMarkCatalogueWorkbookBuilder
{
    public static byte[] BuildBucket(SharedMarkCatalogueResult result, string bucketName, IReadOnlyList<SharedMarkCatalogueRow> rows)
    {
        var wb = new XSSFWorkbook();
        var includeYearColumn = bucketName == "Low Grown"; // matches the original: only the Low Grown PDF has a trailing Year column
        WriteSheet(wb, bucketName, result, rows, includeYearColumn);

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        return ms.ToArray();
    }

    private static void WriteSheet(
        XSSFWorkbook wb, string bucketName, SharedMarkCatalogueResult result,
        IReadOnlyList<SharedMarkCatalogueRow> rows, bool includeYearColumn)
    {
        var ws = wb.CreateSheet(bucketName == "Low Grown" ? "Low Grown" : "High & Medium Grown");
        var weeks = result.MonthCalendar; // ascending (SaleNo, Date), including future/blank weeks

        var titleStyle = wb.CreateCellStyle();
        var titleFont = wb.CreateFont();
        titleFont.IsBold = true;
        titleFont.FontHeightInPoints = 14;
        titleStyle.SetFont(titleFont);
        titleStyle.Alignment = HorizontalAlignment.Center;

        var headerStyle = wb.CreateCellStyle();
        var headerFont = wb.CreateFont();
        headerFont.IsBold = true;
        headerStyle.SetFont(headerFont);
        headerStyle.Alignment = HorizontalAlignment.Center;
        headerStyle.BorderTop = BorderStyle.Thin;
        headerStyle.BorderBottom = BorderStyle.Thin;
        headerStyle.BorderLeft = BorderStyle.Thin;
        headerStyle.BorderRight = BorderStyle.Thin;

        var dateHeaderStyle = wb.CreateCellStyle();
        dateHeaderStyle.CloneStyleFrom(headerStyle);
        dateHeaderStyle.DataFormat = wb.CreateDataFormat().GetFormat("dd/mm/yyyy");

        // Every data cell in the original carries a thin grid border, not just the header
        // rows — matching that means every style below (name/broker-label/qty/zero) sets
        // the same four borders rather than leaving data rows borderless.
        static void ApplyGridBorders(ICellStyle style)
        {
            style.BorderTop = BorderStyle.Thin;
            style.BorderBottom = BorderStyle.Thin;
            style.BorderLeft = BorderStyle.Thin;
            style.BorderRight = BorderStyle.Thin;
        }

        var estateNameStyle = wb.CreateCellStyle();
        var estateNameFont = wb.CreateFont();
        estateNameFont.IsBold = true;
        estateNameStyle.SetFont(estateNameFont);
        ApplyGridBorders(estateNameStyle);

        var brokerLabelStyle = wb.CreateCellStyle();
        ApplyGridBorders(brokerLabelStyle);

        var qtyStyle = wb.CreateCellStyle();
        qtyStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0");
        ApplyGridBorders(qtyStyle);

        // A week/Month/Year cell with nothing catalogued is shown as an explicit "0" on a
        // solid red fill in the original, rather than left blank — a deliberate visual flag
        // for "no catalogue this week", not just an absence of data.
        var zeroQtyStyle = wb.CreateCellStyle();
        zeroQtyStyle.CloneStyleFrom(qtyStyle);
        zeroQtyStyle.FillForegroundColor = IndexedColors.Red.Index;
        zeroQtyStyle.FillPattern = FillPattern.SolidForeground;

        const int labelCol = 0;
        var weekCols = weeks.Count;
        var monthCol = labelCol + 1 + weekCols;
        var yearCol = includeYearColumn ? monthCol + 1 : -1;
        var lastCol = includeYearColumn ? yearCol : monthCol;

        // Row 0: title, merged across the full width.
        var titleRow = ws.CreateRow(0);
        var titleCell = titleRow.CreateCell(labelCol);
        titleCell.SetCellValue($"Sharing Mark Catalogued Summary - {bucketName}  {result.SaleDate:MMM   yyyy} (Without  R/P)");
        titleCell.CellStyle = titleStyle;
        ws.AddMergedRegion(new CellRangeAddress(0, 0, labelCol, lastCol));

        // Row 1: "Sale No & Date" | week sale numbers | "Month" | ("Year")
        var saleNoRow = ws.CreateRow(1);
        var saleNoLabelCell = saleNoRow.CreateCell(labelCol);
        saleNoLabelCell.SetCellValue("Sale No & Date");
        saleNoLabelCell.CellStyle = headerStyle;
        for (var i = 0; i < weekCols; i++)
        {
            var c = saleNoRow.CreateCell(labelCol + 1 + i);
            c.SetCellValue(weeks[i].SaleNo);
            c.CellStyle = headerStyle;
        }
        var monthHeaderCell = saleNoRow.CreateCell(monthCol);
        monthHeaderCell.SetCellValue("Month");
        monthHeaderCell.CellStyle = headerStyle;
        if (includeYearColumn)
        {
            var yearHeaderCell = saleNoRow.CreateCell(yearCol);
            yearHeaderCell.SetCellValue("Year");
            yearHeaderCell.CellStyle = headerStyle;
        }

        // Row 2: "Factory Name" | each week's date | "Todate Qty" | ("Todate Qty")
        var dateRow = ws.CreateRow(2);
        var factoryNameCell = dateRow.CreateCell(labelCol);
        factoryNameCell.SetCellValue("Factory Name");
        factoryNameCell.CellStyle = headerStyle;
        for (var i = 0; i < weekCols; i++)
        {
            var c = dateRow.CreateCell(labelCol + 1 + i);
            c.SetCellValue(weeks[i].Date);
            c.CellStyle = dateHeaderStyle;
        }
        var monthTodateCell = dateRow.CreateCell(monthCol);
        monthTodateCell.SetCellValue("Todate Qty");
        monthTodateCell.CellStyle = headerStyle;
        if (includeYearColumn)
        {
            var yearTodateCell = dateRow.CreateCell(yearCol);
            yearTodateCell.SetCellValue("Todate Qty");
            yearTodateCell.CellStyle = headerStyle;
        }

        // Writes a quantity cell. hasData distinguishes a week that's actually happened
        // (this sale or an earlier one) from a future week the calendar lays out a blank
        // column for before it happens — per explicit instruction, a future week has no
        // data to report at all and stays genuinely empty (no "0", no fill), while a week
        // that HAS happened with a real recorded quantity of zero is flagged explicitly:
        // "0" on a red fill, distinct from "nothing to say yet". Month/Year totals are
        // always for already-happened sales, so they always pass hasData=true.
        static void WriteQtyCell(ICell cell, decimal qty, bool hasData, ICellStyle qtyStyle, ICellStyle zeroQtyStyle)
        {
            if (!hasData) { cell.CellStyle = qtyStyle; return; }
            cell.SetCellValue((double)qty);
            cell.CellStyle = qty > 0 ? qtyStyle : zeroQtyStyle;
        }

        // Per-mark blocks: bold name row, then one row per broker — ASC always first
        // (matching the original), the rest busiest-first. Row order is by Code (not by
        // EstateName) per explicit instruction — e.g. "BF..." codes sort ahead of "MF..."/
        // "SS..." ones — via CodeSortKey's numeric sort, not a plain string compare (which
        // would put "MF10" ahead of "MF2"). SharedMarkCatalogueService.BuildRows already
        // returns rows in this order, so this just re-asserts it rather than trusting
        // caller order silently.
        var r = 3;
        foreach (var row in rows.OrderBy(x => SharedMarkCatalogueService.CodeSortKey(x.Code)).ThenBy(x => x.EstateName, StringComparer.OrdinalIgnoreCase))
        {
            var nameRow = ws.CreateRow(r++);
            var nameCell = nameRow.CreateCell(labelCol);
            nameCell.SetCellValue(row.EstateName);
            nameCell.CellStyle = estateNameStyle;

            var brokers = row.SaleQtyByBrokerAndSaleNo.Keys
                .Union(row.MonthQtyByBroker.Keys, StringComparer.OrdinalIgnoreCase)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(b => string.Equals(b, "ASC", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .ThenByDescending(b => row.MonthQtyByBroker.GetValueOrDefault(b))
                .ToList();

            foreach (var broker in brokers)
            {
                var dataRow = ws.CreateRow(r++);
                var brokerCell = dataRow.CreateCell(labelCol);
                brokerCell.SetCellValue(broker);
                brokerCell.CellStyle = brokerLabelStyle;

                var perWeek = row.SaleQtyByBrokerAndSaleNo.GetValueOrDefault(broker);
                for (var i = 0; i < weekCols; i++)
                {
                    var qty = perWeek?.GetValueOrDefault(weeks[i].SaleNo) ?? 0;
                    var hasData = weeks[i].SaleNo <= result.SaleNo;
                    WriteQtyCell(dataRow.CreateCell(labelCol + 1 + i), qty, hasData, qtyStyle, zeroQtyStyle);
                }

                WriteQtyCell(dataRow.CreateCell(monthCol), row.MonthQtyByBroker.GetValueOrDefault(broker), true, qtyStyle, zeroQtyStyle);

                if (includeYearColumn)
                    WriteQtyCell(dataRow.CreateCell(yearCol), row.YearQtyByBroker.GetValueOrDefault(broker), true, qtyStyle, zeroQtyStyle);
            }
        }

        ws.SetColumnWidth(labelCol, 22 * 256);
        for (var i = labelCol + 1; i <= lastCol; i++) ws.SetColumnWidth(i, 12 * 256);

        // Landscape + fit-to-width so every week/Month/Year column lands on the same page
        // as the estate name — without this, a real conversion (LibreOffice, or Excel's own
        // Print) uses the default page size and paginates the wide sheet horizontally,
        // splitting Month/Year onto their own page block, disconnected from the row labels
        // that give the numbers meaning (found live converting a real generated report).
        // FitHeight=0 leaves the row count free to span as many pages tall as needed.
        ws.PrintSetup.Landscape = true;
        ws.PrintSetup.FitWidth = 1;
        ws.PrintSetup.FitHeight = 0;
        ws.FitToPage = true;
    }
}
