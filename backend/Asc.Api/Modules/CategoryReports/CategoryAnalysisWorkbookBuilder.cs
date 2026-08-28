using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.CategoryReports;

/// <summary>
/// Renders a CategoryAnalysisDto into a six-sheet workbook: Summary, Broker Distribution, Sold
/// Outsold Unsold, Price Tiers, Sale Trend, and the flagship "Price & Classification — Sale x
/// Broker" sheet (one row per sale x broker, full tier breakdown — see CategoryAnalysisEngine's
/// own doc comment for why unsold lots never appear in a tier column). Uses NPOI (XSSFWorkbook),
/// the same library and cell-style conventions as FactorySaleSummaryWorkbookBuilder — a title
/// row, bordered header rows, and light tier-tinted fills, no native charts (this codebase's
/// NPOI-built reports are data-table-first; see that file's own doc comment for why).
/// </summary>
internal static class CategoryAnalysisWorkbookBuilder
{
    private static readonly byte[] Gold = [0xC1, 0x92, 0x0C];
    private static readonly byte[] GoldDeep = [0x8F, 0x6C, 0x08];
    private static readonly byte[] Olive = [0x71, 0x7C, 0x21];
    private static readonly byte[] OliveDeep = [0x4E, 0x57, 0x15];
    private static readonly byte[] SelectBestTint = [0xFC, 0xE9, 0xBE];
    private static readonly byte[] BestTint = [0xE7, 0xEA, 0xCB];
    private static readonly byte[] BelowBestTint = [0xFB, 0xE9, 0xD6];
    private static readonly byte[] PoorTint = [0xF6, 0xD9, 0xD4];
    private static readonly byte[] AltRowTint = [0xF7, 0xF8, 0xF4];

    private static XSSFColor Rgb(byte[] rgb)
    {
#pragma warning disable CS0618 // parameterless XSSFColor() is the only constructor this NPOI version exposes for a raw RGB fill
        var color = new XSSFColor();
#pragma warning restore CS0618
        color.RGB = rgb;
        return color;
    }

    private sealed class Styles(XSSFWorkbook wb)
    {
        public ICellStyle Title = BuildTitle(wb);
        public ICellStyle Subtitle = BuildSubtitle(wb);
        public ICellStyle Header = BuildHeader(wb);
        public ICellStyle Label = BuildBordered(wb, bold: true);
        public ICellStyle Text = BuildBordered(wb, bold: false);
        public ICellStyle Int = BuildBordered(wb, bold: false, format: "#,##0");
        public ICellStyle Money = BuildBordered(wb, bold: false, format: "#,##0.00");
        public ICellStyle MoneyInt = BuildBordered(wb, bold: false, format: "#,##0");
        public ICellStyle Pct = BuildBordered(wb, bold: false, format: "0.0%");
        public ICellStyle SaleBand = BuildSaleBand(wb);

        private readonly XSSFWorkbook _wb = wb;

        public ICellStyle Tinted(ICellStyle basis, byte[] rgb)
        {
            var s = (XSSFCellStyle)_wb.CreateCellStyle();
            s.CloneStyleFrom(basis);
            s.SetFillForegroundColor(Rgb(rgb));
            s.FillPattern = FillPattern.SolidForeground;
            return s;
        }

        private static ICellStyle BuildTitle(XSSFWorkbook wb)
        {
            var style = (XSSFCellStyle)wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.IsBold = true;
            font.FontHeightInPoints = 14;
            style.SetFont(font);
            return style;
        }

        private static ICellStyle BuildSubtitle(XSSFWorkbook wb)
        {
            var style = (XSSFCellStyle)wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.FontHeightInPoints = 10;
            font.IsItalic = true;
            font.Color = NPOI.HSSF.Util.HSSFColor.Grey50Percent.Index;
            style.SetFont(font);
            return style;
        }

        private static ICellStyle BuildHeader(XSSFWorkbook wb)
        {
            var style = (XSSFCellStyle)wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.IsBold = true;
            font.Color = IndexedColors.White.Index;
            style.SetFont(font);
            style.SetFillForegroundColor(Rgb(OliveDeep));
            style.FillPattern = FillPattern.SolidForeground;
            style.Alignment = HorizontalAlignment.Center;
            style.VerticalAlignment = VerticalAlignment.Center;
            style.WrapText = true;
            SetThinBorder(style);
            return style;
        }

        private static ICellStyle BuildSaleBand(XSSFWorkbook wb)
        {
            var style = (XSSFCellStyle)wb.CreateCellStyle();
            var font = wb.CreateFont();
            font.IsBold = true;
            font.Color = IndexedColors.White.Index;
            style.SetFont(font);
            style.SetFillForegroundColor(Rgb(GoldDeep));
            style.FillPattern = FillPattern.SolidForeground;
            SetThinBorder(style);
            return style;
        }

        private static ICellStyle BuildBordered(XSSFWorkbook wb, bool bold, string? format = null)
        {
            var style = (XSSFCellStyle)wb.CreateCellStyle();
            if (bold)
            {
                var font = wb.CreateFont();
                font.IsBold = true;
                style.SetFont(font);
            }
            if (format is not null) style.DataFormat = wb.CreateDataFormat().GetFormat(format);
            style.Alignment = format is null && !bold ? HorizontalAlignment.Left : HorizontalAlignment.Center;
            SetThinBorder(style);
            return style;
        }

        private static void SetThinBorder(ICellStyle style)
        {
            style.BorderTop = BorderStyle.Thin;
            style.BorderBottom = BorderStyle.Thin;
            style.BorderLeft = BorderStyle.Thin;
            style.BorderRight = BorderStyle.Thin;
        }
    }

    public static byte[] Build(CategoryAnalysisDto data)
    {
        var wb = new XSSFWorkbook();
        var styles = new Styles(wb);

        WriteSummary(wb, styles, data);
        WriteBrokerDistribution(wb, styles, data);
        WriteStatus(wb, styles, data);
        WriteTiers(wb, styles, data);
        WriteTrend(wb, styles, data);
        WriteSaleBroker(wb, styles, data);

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        return ms.ToArray();
    }

    private static void TitleBlock(ISheet ws, Styles s, string title, string subtitle, int lastCol)
    {
        var r0 = ws.CreateRow(0);
        r0.CreateCell(0).SetCellValue(title);
        r0.GetCell(0).CellStyle = s.Title;
        ws.AddMergedRegion(new CellRangeAddress(0, 0, 0, lastCol));

        var r1 = ws.CreateRow(1);
        r1.CreateCell(0).SetCellValue(subtitle);
        r1.GetCell(0).CellStyle = s.Subtitle;
        ws.AddMergedRegion(new CellRangeAddress(1, 1, 0, lastCol));
    }

    private static void HeaderRow(ISheet ws, Styles s, int rowIdx, params string[] headers)
    {
        var row = ws.CreateRow(rowIdx);
        for (var i = 0; i < headers.Length; i++)
        {
            var c = row.CreateCell(i);
            c.SetCellValue(headers[i]);
            c.CellStyle = s.Header;
        }
    }

    private static void SetWidths(ISheet ws, params int[] widthsChars)
    {
        for (var i = 0; i < widthsChars.Length; i++) ws.SetColumnWidth(i, widthsChars[i] * 256);
    }

    // ================= Summary =================
    private static void WriteSummary(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Summary");
        TitleBlock(ws, s, $"{d.Category} Category — Price & Classification Analysis",
            $"{d.Sales.Count} sale(s): {string.Join(", ", d.Sales.Select(x => x.Label))}", 3);

        (string Label, string Value)[] kpis =
        [
            ("Total lots offered", $"{d.Summary.TotalLots:N0}"),
            ("Sold", $"{d.Summary.Sold:N0}  ({Pct(d.Summary.Sold, d.Summary.TotalLots)})"),
            ("Outsold", $"{d.Summary.Outsold:N0}  ({Pct(d.Summary.Outsold, d.Summary.TotalLots)})"),
            ("Unsold", $"{d.Summary.Unsold:N0}  ({Pct(d.Summary.Unsold, d.Summary.TotalLots)})"),
            ("Brokers active in category", $"{d.Summary.BrokerCount:N0}"),
            ("Distinct selling marks", $"{d.Summary.DistinctMarks:N0}"),
        ];

        var r = 3;
        foreach (var (label, value) in kpis)
        {
            var row = ws.CreateRow(r++);
            row.CreateCell(0).SetCellValue(label);
            row.GetCell(0).CellStyle = s.Text;
            row.CreateCell(1).SetCellValue(value);
            row.GetCell(1).CellStyle = s.Label;
        }

        r++;
        var noteRow = ws.CreateRow(r);
        noteRow.CreateCell(0).SetCellValue(
            "Sheets: Broker Distribution, Sold Outsold Unsold, Price Tiers, Sale Trend, and the flagship " +
            "\"Price & Classification — Sale x Broker\" table (achieved price and the Select Best/Best/Below " +
            "Best/Poor split for every broker, in every selected sale).");
        noteRow.GetCell(0).CellStyle = s.Subtitle;
        ws.AddMergedRegion(new CellRangeAddress(r, r, 0, 3));

        SetWidths(ws, 30, 26, 14, 14);
    }

    private static string Pct(int part, int total) => total > 0 ? $"{part * 100.0 / total:0.0}%" : "0.0%";

    // ================= Broker Distribution =================
    private static void WriteBrokerDistribution(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Broker Distribution");
        TitleBlock(ws, s, "Mark Distribution Among Brokers", $"{d.Category} category, combined across selected sales", 8);
        HeaderRow(ws, s, 3, "Broker", "Lots offered", "Share of lots", "Distinct marks",
            "Qty offered (kg)", "Qty sold (kg)", "Proceeds (Rs.)", "Avg. price (Rs./kg)");

        var r = 4;
        foreach (var row in d.BrokerDistribution)
        {
            var xr = ws.CreateRow(r++);
            Cell(xr, 0, row.Broker, s.Label);
            Cell(xr, 1, row.Lots, s.Int);
            Cell(xr, 2, row.SharePct / 100.0, s.Pct);
            Cell(xr, 3, row.DistinctMarks, s.Int);
            Cell(xr, 4, (double)row.QtyOfferedKg, s.Int);
            Cell(xr, 5, (double)row.QtySoldKg, s.Int);
            Cell(xr, 6, (double)row.ProceedsRs, s.MoneyInt);
            Cell(xr, 7, (double)row.AvgPriceRsKg, s.Money);
        }

        SetWidths(ws, 22, 13, 13, 13, 16, 15, 16, 16);
    }

    // ================= Sold / Outsold / Unsold =================
    private static void WriteStatus(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Sold Outsold Unsold");
        TitleBlock(ws, s, "Auction Outcome by Broker", $"{d.Category} category — Sold vs. Outsold vs. Unsold", 7);
        HeaderRow(ws, s, 3, "Broker", "Sold", "Outsold", "Unsold", "Total offered", "Sold %", "Outsold %", "Unsold %");

        var r = 4;
        foreach (var row in d.Status)
        {
            var xr = ws.CreateRow(r++);
            Cell(xr, 0, row.Broker, s.Label);
            Cell(xr, 1, row.Sold, s.Int);
            Cell(xr, 2, row.Outsold, s.Int);
            Cell(xr, 3, row.Unsold, s.Int);
            Cell(xr, 4, row.Total, s.Int);
            Cell(xr, 5, row.SoldPct / 100.0, s.Pct);
            Cell(xr, 6, row.OutsoldPct / 100.0, s.Pct);
            Cell(xr, 7, row.UnsoldPct / 100.0, s.Pct);
        }

        var t = ws.CreateRow(r);
        Cell(t, 0, "TOTAL", s.Label);
        Cell(t, 1, d.Summary.Sold, s.Int);
        Cell(t, 2, d.Summary.Outsold, s.Int);
        Cell(t, 3, d.Summary.Unsold, s.Int);
        Cell(t, 4, d.Summary.TotalLots, s.Int);
        Cell(t, 5, d.Summary.TotalLots > 0 ? d.Summary.Sold / (double)d.Summary.TotalLots : 0, s.Pct);
        Cell(t, 6, d.Summary.TotalLots > 0 ? d.Summary.Outsold / (double)d.Summary.TotalLots : 0, s.Pct);
        Cell(t, 7, d.Summary.TotalLots > 0 ? d.Summary.Unsold / (double)d.Summary.TotalLots : 0, s.Pct);

        SetWidths(ws, 22, 10, 10, 10, 14, 11, 12, 11);
    }

    // ================= Price Tiers =================
    private static void WriteTiers(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Price Tiers");
        TitleBlock(ws, s, "Price Variation by Classification Tier",
            "Select Best / Best / Below Best / Poor — quartiles of achieved price among each sale's own sold lots, pooled here", 6);
        HeaderRow(ws, s, 3, "Tier", "Lots", "Share of sold lots", "Qty (kg)", "Avg. price (Rs./kg)", "Min price (Rs./kg)", "Max price (Rs./kg)");

        var tint = new Dictionary<string, byte[]>
        {
            ["Select Best"] = SelectBestTint, ["Best"] = BestTint, ["Below Best"] = BelowBestTint, ["Poor"] = PoorTint,
        };

        var r = 4;
        foreach (var row in d.Tiers)
        {
            var style = s.Tinted(s.Label, tint.GetValueOrDefault(row.Tier, AltRowTint));
            var numStyle = s.Tinted(s.Int, tint.GetValueOrDefault(row.Tier, AltRowTint));
            var pctStyle = s.Tinted(s.Pct, tint.GetValueOrDefault(row.Tier, AltRowTint));

            var xr = ws.CreateRow(r++);
            Cell(xr, 0, row.Tier, style);
            Cell(xr, 1, row.Lots, numStyle);
            Cell(xr, 2, row.SharePct / 100.0, pctStyle);
            Cell(xr, 3, (double)row.QtyKg, numStyle);
            Cell(xr, 4, (double)row.AvgPriceRsKg, numStyle);
            Cell(xr, 5, (double)row.MinPriceRsKg, numStyle);
            Cell(xr, 6, (double)row.MaxPriceRsKg, numStyle);
        }

        r += 2;
        var sectionRow = ws.CreateRow(r++);
        sectionRow.CreateCell(0).SetCellValue("Price tier by broker");
        sectionRow.GetCell(0).CellStyle = s.Subtitle;
        HeaderRow(ws, s, r, "Tier", "Broker", "Lots", "Qty (kg)", "Avg. price (Rs./kg)");
        r++;
        var tierOrder = new[] { "Select Best", "Best", "Below Best", "Poor" };
        foreach (var row in d.TierByBroker.OrderBy(x => Array.IndexOf(tierOrder, x.Tier)).ThenByDescending(x => x.Lots))
        {
            var xr = ws.CreateRow(r++);
            Cell(xr, 0, row.Tier, s.Text);
            Cell(xr, 1, row.Broker, s.Text);
            Cell(xr, 2, row.Lots, s.Int);
            Cell(xr, 3, (double)row.QtyKg, s.Int);
            Cell(xr, 4, (double)row.AvgPriceRsKg, s.Money);
        }

        SetWidths(ws, 16, 20, 15, 12, 16, 15, 15);
    }

    // ================= Sale Trend =================
    private static void WriteTrend(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Sale Trend");
        TitleBlock(ws, s, "Sale-by-Sale Behaviour", $"{d.Category} category performance across {d.Sales.Count} selected sale(s)", 10);
        HeaderRow(ws, s, 3, "Sale", "Lots offered", "Sold", "Outsold", "Unsold", "Sold %",
            "Qty offered (kg)", "Qty sold (kg)", "Avg. price (Rs./kg)", "Proceeds (Rs.)");

        var r = 4;
        foreach (var row in d.Trend)
        {
            var xr = ws.CreateRow(r++);
            Cell(xr, 0, $"Sale {row.SaleNo}/{row.SaleYear}", s.Label);
            Cell(xr, 1, row.LotsOffered, s.Int);
            Cell(xr, 2, row.Sold, s.Int);
            Cell(xr, 3, row.Outsold, s.Int);
            Cell(xr, 4, row.Unsold, s.Int);
            Cell(xr, 5, row.SoldPct / 100.0, s.Pct);
            Cell(xr, 6, (double)row.QtyOfferedKg, s.Int);
            Cell(xr, 7, (double)row.QtySoldKg, s.Int);
            Cell(xr, 8, (double)row.AvgPriceRsKg, s.Money);
            Cell(xr, 9, (double)row.ProceedsRs, s.MoneyInt);
        }

        SetWidths(ws, 14, 13, 9, 10, 10, 10, 16, 15, 17, 16);
    }

    // ================= Price & Classification — Sale x Broker (flagship) =================
    private static void WriteSaleBroker(XSSFWorkbook wb, Styles s, CategoryAnalysisDto d)
    {
        var ws = wb.CreateSheet("Price & Classification");
        TitleBlock(ws, s, "Price & Classification — Sale x Broker",
            "Every broker's book in every selected sale: lots offered, sold outcome, achieved price, and how those sold lots split across the four quality tiers. " +
            "Unsold lots carry no achieved price, so they are never assigned a tier.", 16);

        string[] headers =
        [
            "Sale", "Broker", "Lots offered", "Sold %", "Avg. price (Rs./kg)",
            "Select Best — lots", "Select Best — share", "Select Best — avg price",
            "Best — lots", "Best — share", "Best — avg price",
            "Below Best — lots", "Below Best — share", "Below Best — avg price",
            "Poor — lots", "Poor — share", "Poor — avg price",
        ];
        HeaderRow(ws, s, 3, headers);

        var tint = new (int Start, byte[] Color)[] { (5, SelectBestTint), (8, BestTint), (11, BelowBestTint), (14, PoorTint) };

        var r = 4;
        int? lastSale = null;
        foreach (var row in d.SaleBroker)
        {
            if (lastSale != row.SaleNo * 10000 + row.SaleYear)
            {
                lastSale = row.SaleNo * 10000 + row.SaleYear;
                var band = ws.CreateRow(r++);
                var c = band.CreateCell(0);
                c.SetCellValue($"Sale {row.SaleNo}/{row.SaleYear}");
                c.CellStyle = s.SaleBand;
                for (var i = 1; i < headers.Length; i++) band.CreateCell(i).CellStyle = s.SaleBand;
                ws.AddMergedRegion(new CellRangeAddress(r - 1, r - 1, 0, headers.Length - 1));
            }

            var xr = ws.CreateRow(r++);
            Cell(xr, 0, $"Sale {row.SaleNo}", s.Label);
            Cell(xr, 1, row.Broker, s.Label);
            Cell(xr, 2, row.Lots, s.Int);
            Cell(xr, 3, row.SoldPct / 100.0, s.Pct);
            Cell(xr, 4, (double)row.AvgPriceRsKg, s.Money);
            Cell(xr, 5, row.SelectBestLots, s.Int);
            Cell(xr, 6, row.SelectBestSharePct / 100.0, s.Pct);
            Cell(xr, 7, (double)row.SelectBestAvgPriceRsKg, s.Int);
            Cell(xr, 8, row.BestLots, s.Int);
            Cell(xr, 9, row.BestSharePct / 100.0, s.Pct);
            Cell(xr, 10, (double)row.BestAvgPriceRsKg, s.Int);
            Cell(xr, 11, row.BelowBestLots, s.Int);
            Cell(xr, 12, row.BelowBestSharePct / 100.0, s.Pct);
            Cell(xr, 13, (double)row.BelowBestAvgPriceRsKg, s.Int);
            Cell(xr, 14, row.PoorLots, s.Int);
            Cell(xr, 15, row.PoorSharePct / 100.0, s.Pct);
            Cell(xr, 16, (double)row.PoorAvgPriceRsKg, s.Int);

            foreach (var (start, color) in tint)
            {
                var tinted = s.Tinted(s.Int, color);
                for (var i = start; i < start + 3; i++) xr.GetCell(i).CellStyle = i is 6 or 9 or 12 or 15 ? s.Tinted(s.Pct, color) : tinted;
            }
        }

        SetWidths(ws, 10, 20, 12, 9, 15, 11, 12, 13, 9, 10, 12, 12, 13, 14, 9, 10, 12);
        ws.CreateFreezePane(0, 4);
    }

    private static void Cell(IRow row, int col, string value, ICellStyle style)
    {
        var c = row.CreateCell(col);
        c.SetCellValue(value);
        c.CellStyle = style;
    }

    private static void Cell(IRow row, int col, double value, ICellStyle style)
    {
        var c = row.CreateCell(col);
        c.SetCellValue(value);
        c.CellStyle = style;
    }

    private static void Cell(IRow row, int col, int value, ICellStyle style)
    {
        var c = row.CreateCell(col);
        c.SetCellValue(value);
        c.CellStyle = style;
    }
}
