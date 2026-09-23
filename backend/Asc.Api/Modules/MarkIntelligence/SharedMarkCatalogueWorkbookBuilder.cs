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
/// Factory (every sub-mark under the same factory code already merged into one row by
/// SharedMarkCatalogueService — per explicit instruction, same factory code number means
/// one row) ordered by that Factory code (not name — see SharedMarkCatalogueRow.Code): a
/// bold name row followed by one row per broker with that
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
    // The label column's own width, in characters (SetColumnWidth below) — also the basis
    // for EstimateWrappedLines' row-height math, kept as one constant so the two can't drift.
    private const int LabelColumnChars = 34;

    /// <summary>How many lines a bold estate/factory name needs to wrap onto within the
    /// label column, so its row's height can be set to actually fit them — found live that
    /// WrapText alone isn't enough (see estateNameStyle's own doc comment: LibreOffice's
    /// headless PDF conversion doesn't auto-grow a wrapped row's height the way Excel does
    /// when opened interactively, so an unset row height let a long name's second line
    /// overlap the row below it in the real converted PDF). Plain length-vs-column-width
    /// ratio, no extra safety margin: an earlier version used 70% of the column's char width
    /// as the effective per-line capacity to intentionally over-estimate, but that
    /// overcorrected — found live converting a real Sale 38/2026 PDF, "Lantern Hill Upper Tea
    /// Estate" (29 chars, well under the 34-char column and confirmed NOT wrapping in the
    /// real render) still got flagged for 2 lines and rendered with a visibly oversized,
    /// half-empty name row. The two real names that originally exposed the overlap bug
    /// (Diggala Enterprises Tea Processing Center, 42 chars; Polkollagollawatta Tea
    /// Processing Center, 41 chars) are both comfortably over LabelColumnChars either way, so
    /// dropping the 0.7 factor still calls those two right.</summary>
    internal static int EstimateWrappedLines(string text) =>
        Math.Max(1, (int)Math.Ceiling(text.Length / (double)LabelColumnChars));

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
        // result.MonthCalendar is already in the report's own display order (target sale
        // first — see SharedMarkCatalogueService.BuildMonthCalendar's own doc comment), so
        // no reordering needed here. An earlier version of this reversed a plain-ascending
        // calendar instead, which put not-yet-happened weeks ahead of the target sale
        // whenever the target wasn't its month's last week (found live: Sale 39/2026,
        // October's first sale, showed 42/41/40 before 39).
        var weeks = result.MonthCalendar;

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
        // Some real estate/factory names run long (confirmed live: "Diggala Enterprises Tea
        // Processing Center", "Polkollagollawatta Tea Processing Center" — over 40
        // characters) and were clipping against the label column's old fixed width. Wrapping
        // is the safety net for whatever's still longer than the widened column below — but
        // WrapText alone isn't enough: it was assumed Excel/LibreOffice auto-grow a wrapped
        // row's height, and Excel does when opened interactively, but LibreOffice's headless
        // PDF conversion does NOT (found live: Diggala's own two-line wrapped name rendered
        // on top of the row above it, overlapping text, in the real converted PDF). The row
        // height has to be set explicitly instead — see LabelColumnChars/EstimateWrappedLines
        // below, applied when each name row is created.
        estateNameStyle.WrapText = true;
        ApplyGridBorders(estateNameStyle);

        var brokerLabelStyle = wb.CreateCellStyle();
        ApplyGridBorders(brokerLabelStyle);

        // A genuine Orthodox/CTC pair (SharedMarkCatalogueService.PairOrthodoxAndCtc) gets
        // one shared factory-name header, then each side's own bold, green-filled "ORTHODOX"/
        // "CTC" label row before its broker rows — matching the original hand-built PDF's own
        // sub-block styling for exactly these factories (confirmed live: Danawala, Brombil,
        // Alagalla, Liverpool).
        var productionLabelStyle = wb.CreateCellStyle();
        var productionLabelFont = wb.CreateFont();
        productionLabelFont.IsBold = true;
        productionLabelFont.IsItalic = true;
        productionLabelStyle.SetFont(productionLabelFont);
        productionLabelStyle.FillForegroundColor = IndexedColors.LightGreen.Index;
        productionLabelStyle.FillPattern = FillPattern.SolidForeground;
        ApplyGridBorders(productionLabelStyle);

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

        // Month-to-date/Year-to-date are the report's own running totals, not just another
        // week — bolded per explicit instruction so they stand out from the plain weekly
        // figures either side of them.
        var boldQtyFont = wb.CreateFont();
        boldQtyFont.IsBold = true;
        var boldQtyStyle = wb.CreateCellStyle();
        boldQtyStyle.CloneStyleFrom(qtyStyle);
        boldQtyStyle.SetFont(boldQtyFont);
        var boldZeroQtyStyle = wb.CreateCellStyle();
        boldZeroQtyStyle.CloneStyleFrom(zeroQtyStyle);
        boldZeroQtyStyle.SetFont(boldQtyFont);

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
        // returns rows in this order (which also keeps a paired Orthodox/CTC row adjacent to
        // its sibling, immediately after it), so this just re-asserts it rather than
        // trusting caller order silently.
        var orderedRows = rows.OrderBy(x => SharedMarkCatalogueService.CodeSortKey(x.Code)).ThenBy(x => x.EstateName, StringComparer.OrdinalIgnoreCase).ToList();

        // Tracks each top-level factory block's own row range (name row through its last
        // broker row, including a paired CTC sub-block sharing that same header) so a page
        // break can be inserted before whichever block wouldn't otherwise fit — see the page
        // break pass below, after the loop.
        var blockRanges = new List<(int Start, int End)>();
        var blockStart = -1;

        var r = 3;
        SharedMarkCatalogueRow? previous = null;
        foreach (var row in orderedRows)
        {
            // A paired CTC row immediately following its own Orthodox sibling shares that
            // sibling's factory-name header instead of getting a second one of its own —
            // matching the original's one-factory-header, two-labeled-sub-blocks layout.
            var continuesPair = row.ProductionLabel == "Ctc" && previous?.ProductionLabel == "Orthodox" &&
                string.Equals(previous.FactoryDisplayName, row.FactoryDisplayName, StringComparison.OrdinalIgnoreCase);
            if (!continuesPair)
            {
                if (blockStart != -1) blockRanges.Add((blockStart, r - 1));
                blockStart = r;

                var displayName = row.FactoryDisplayName ?? row.EstateName;
                var nameRow = ws.CreateRow(r++);
                var nameCell = nameRow.CreateCell(labelCol);
                nameCell.SetCellValue(displayName);
                nameCell.CellStyle = estateNameStyle;
                var lines = EstimateWrappedLines(displayName);
                if (lines > 1) nameRow.HeightInPoints = ws.DefaultRowHeightInPoints * lines;
            }
            previous = row;

            if (row.ProductionLabel is { } label)
            {
                var labelRow = ws.CreateRow(r++);
                var labelCell = labelRow.CreateCell(labelCol);
                labelCell.SetCellValue(label.ToUpperInvariant());
                labelCell.CellStyle = productionLabelStyle;
            }

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

                WriteQtyCell(dataRow.CreateCell(monthCol), row.MonthQtyByBroker.GetValueOrDefault(broker), true, boldQtyStyle, boldZeroQtyStyle);

                if (includeYearColumn)
                    WriteQtyCell(dataRow.CreateCell(yearCol), row.YearQtyByBroker.GetValueOrDefault(broker), true, boldQtyStyle, boldZeroQtyStyle);
            }
        }
        if (blockStart != -1) blockRanges.Add((blockStart, r - 1));

        // Widened from 22 — several real estate/factory names (see estateNameStyle's own
        // comment) were wider than that and clipping in both Excel and the PDF conversion.
        // Same value EstimateWrappedLines used above to size each name row's height — kept
        // as one constant (LabelColumnChars) rather than two separately-typed numbers so a
        // future width change can't silently stop matching the height math.
        ws.SetColumnWidth(labelCol, LabelColumnChars * 256);
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

        // FitHeight=0 lets the sheet span as many pages tall as the row count needs, so
        // without this the title (row 0) and column headers (rows 1-2) would only ever
        // print on the first page — every later page would start mid-table with no context
        // for what the numbers mean. Repeating them as print titles puts the same title +
        // header rows at the top of every page, matching the original hand-built PDF.
        ws.RepeatingRows = new CellRangeAddress(0, 2, -1, -1);

        InsertPageBreaksBetweenBlocks(ws, blockRanges, headerRowCount: 3);
    }

    /// <summary>Without this, a real conversion (LibreOffice headless, confirmed live on a
    /// Sale 38/2026 PDF) paginates purely by how many rows fit on a page, with no regard for
    /// a factory block's own boundaries — found live: "Rasagalla Estate"'s bold name row
    /// landed as the very last line on page 1, while its ASC/CT broker rows (the numbers that
    /// give that name meaning) printed at the top of page 2 with no name above them at all.
    /// FitHeight=0 (see WriteSheet) leaves row-based pagination to whatever the converter's
    /// own page geometry works out to, so the fix has to predict that geometry and insert an
    /// explicit break of its own whenever a block wouldn't fully fit in what's left on the
    /// current page — never splitting a block itself, only ever moving the whole thing to the
    /// next page.</summary>
    private static void InsertPageBreaksBetweenBlocks(ISheet ws, IReadOnlyList<(int Start, int End)> blockRanges, int headerRowCount)
    {
        // Page geometry mirrors WriteSheet's own PrintSetup: Landscape Letter — confirmed
        // live (MediaBox of a real converted PDF) at 792x612pt, i.e. 612pt of vertical space
        // per page once rotated landscape. Margins are NPOI's own defaults (0.75in top/bottom,
        // unchanged from WriteSheet — nothing here sets them), read back rather than assumed
        // so this can't silently drift out of sync if a margin is ever changed above.
        const double pageHeightPts = 612d;
        var topMarginPts = ws.GetMargin(MarginType.TopMargin) * 72;
        var bottomMarginPts = ws.GetMargin(MarginType.BottomMargin) * 72;

        double RowHeightPts(int rowIndex) => ws.GetRow(rowIndex)?.HeightInPoints ?? ws.DefaultRowHeightInPoints;

        var headerHeightPts = 0d;
        for (var i = 0; i < headerRowCount; i++) headerHeightPts += RowHeightPts(i);

        // The repeating title/header rows (RepeatingRows above) reprint at the top of every
        // page, first included or not — so every page's usable body height is the same figure,
        // page 1 included, not just page 1 minus the others' repeated header.
        var bodyCapacityPts = pageHeightPts - topMarginPts - bottomMarginPts - headerHeightPts;

        var cumulativePts = 0d;
        foreach (var (start, end) in blockRanges)
        {
            var blockHeightPts = 0d;
            for (var i = start; i <= end; i++) blockHeightPts += RowHeightPts(i);

            // cumulativePts > 0 guards against breaking before the very first block placed on
            // a page — a block taller than an entire page's body capacity on its own (in
            // practice: never, for this report) would otherwise never find a page it "fits"
            // on and get pushed forever. Letting it overflow its own page is the correct
            // fallback: still never split mid-block, just accept that one page runs long.
            if (cumulativePts > 0 && cumulativePts + blockHeightPts > bodyCapacityPts)
            {
                ws.SetRowBreak(start - 1);
                cumulativePts = 0;
            }
            cumulativePts += blockHeightPts;
        }
    }
}
