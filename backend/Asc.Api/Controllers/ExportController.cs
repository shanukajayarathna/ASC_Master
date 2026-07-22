using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Controllers;

/// <summary>
/// Excel export. Lots are addressed as (catalogue, lot) pairs so one workbook can span
/// several sales at once (the Catalogue Manager's multi-sale selection). The caller also
/// chooses which columns land in the sheet and in what order — raw catalogue columns or
/// the app's own valuation fields — so a download carries only the columns that were asked
/// for. With no column list the old fixed "Lot Report" layout is produced unchanged.
/// </summary>
[ApiController]
[Route("api/export")]
public class ExportController(ICatalogueSource source, MongoContext db) : ControllerBase
{
    /// <summary>One lot to export, tagged with the sale it belongs to (so cross-sale
    /// exports never need a reverse id→sale lookup).</summary>
    public record LotRef(Guid CatalogueId, Guid LotId);

    /// <summary>One output column. Kind "raw" reads a catalogue column by header from the
    /// lot's raw row; kind "field" reads one of the app's own values (see <see cref="ResolveField"/>).</summary>
    public record ColumnSpec(string Kind, string Key, string Label);

    public record ExportRequest(List<LotRef> Lots, List<ColumnSpec>? Columns);

    // The legacy fixed report — used only when the request names no columns.
    private static readonly ColumnSpec[] LegacyColumns =
    [
        new("field", "lotNo", "Lot No"), new("raw", "Broker", "Broker"), new("raw", "Grade", "Grade"),
        new("field", "gardenMark", "Garden / Mark"), new("raw", "Category", "Category"),
        new("field", "netWeight", "Net Wt (kg)"), new("field", "grossWeight", "Gross Wt (kg)"),
        new("field", "valuation", "Valuation (Rs.)"), new("field", "classification", "Classification"),
        new("field", "standardData", "Standard Data"), new("field", "liquorRemarks", "Liquor Remarks"),
    ];

    [HttpPost("excel")]
    public async Task<IActionResult> ExportExcel(ExportRequest req)
    {
        var columns = req.Columns is { Count: > 0 } ? req.Columns : LegacyColumns.ToList();

        // Resolve every requested lot to its file-backed row merged with the user-entered
        // valuation overlay (which wins), one sale loaded at a time. Output preserves the
        // order the caller sent — that's the order shown on screen, sale blocks and all.
        var resolved = await ResolveLots(req.Lots);
        var lots = new List<(Lot Lot, Catalogue Catalogue)>();
        foreach (var r in req.Lots)
            if (resolved.TryGetValue(r.LotId, out var hit))
                lots.Add(hit);

        var saleNames = lots.Select(l => l.Catalogue.SourceName).Distinct().ToList();
        var reportTitle = saleNames.Count == 1 ? saleNames[0]
            : saleNames.Count == 0 ? "Lot Report"
            : $"{saleNames.Count} sales — {string.Join(", ", saleNames)}";

        using var wb = new XSSFWorkbook();
        var sheet = wb.CreateSheet("Lot Report");

        var (titleStyle, subtitleStyle, headerStyle, cellStyle, currencyStyle) = BuildStyles(wb);

        int lastCol = columns.Count - 1;
        int rowIdx = 0;

        void MergedRow(string text, ICellStyle style, float height)
        {
            var row = sheet.CreateRow(rowIdx);
            row.HeightInPoints = height;
            for (int c = 0; c <= lastCol; c++)
            {
                var cell = row.CreateCell(c);
                cell.CellStyle = style;
                if (c == 0) cell.SetCellValue(text);
            }
            if (lastCol > 0) sheet.AddMergedRegion(new CellRangeAddress(rowIdx, rowIdx, 0, lastCol));
            rowIdx++;
        }

        MergedRow("Asia Siyaka Commodities", titleStyle, 26f);
        MergedRow($"Tea Auction Lot Report — {reportTitle}", subtitleStyle, 18f);
        MergedRow($"Generated {DateTime.UtcNow:dd MMM yyyy, HH:mm} UTC · {lots.Count} lot(s)", subtitleStyle, 16f);
        rowIdx++; // blank spacer row

        var headerRow = sheet.CreateRow(rowIdx++);
        for (int c = 0; c < columns.Count; c++)
        {
            var cell = headerRow.CreateCell(c);
            cell.SetCellValue(columns[c].Label);
            cell.CellStyle = headerStyle;
        }

        foreach (var (lot, catalogue) in lots)
        {
            var row = sheet.CreateRow(rowIdx++);
            for (int c = 0; c < columns.Count; c++)
            {
                var spec = columns[c];
                var cell = row.CreateCell(c);
                // The valuation column carries a real number so it stays sortable/summable in Excel.
                if (spec is { Kind: "field", Key: "valuation" })
                {
                    cell.CellStyle = currencyStyle;
                    var value = lot.Valuation?.EffectiveValue;
                    if (value.HasValue) cell.SetCellValue((double)value.Value);
                }
                else
                {
                    cell.CellStyle = cellStyle;
                    cell.SetCellValue(CellText(lot, catalogue, spec));
                }
            }
        }

        for (int c = 0; c <= lastCol; c++)
            sheet.SetColumnWidth(c, WidthFor(columns[c]) * 256);

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{SanitizeFileName(saleNames.Count == 1 ? saleNames[0] : "asc")}_lot_report.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    /// <summary>Load each distinct sale once, apply its valuation overlay, and index every
    /// wanted lot by id together with its catalogue.</summary>
    private async Task<Dictionary<Guid, (Lot Lot, Catalogue Catalogue)>> ResolveLots(List<LotRef> refs)
    {
        var byCatalogue = refs.GroupBy(r => r.CatalogueId);
        var result = new Dictionary<Guid, (Lot, Catalogue)>();

        foreach (var group in byCatalogue)
        {
            var catalogue = source.GetCatalogue(group.Key);
            if (catalogue is null) continue;

            var wanted = new HashSet<Guid>(group.Select(r => r.LotId));
            var overrides = (await db.Valuations.Find(v => v.CatalogueId == group.Key).ToListAsync())
                .ToDictionary(v => v.LotId, v => v.Valuation);
            var lots = source.GetLots(group.Key) ?? Array.Empty<Lot>();

            foreach (var lot in lots.Where(l => wanted.Contains(l.Id)))
            {
                var merged = overrides.TryGetValue(lot.Id, out var v) ? WithValuation(lot, v) : lot;
                result[lot.Id] = (merged, catalogue);
            }
        }
        return result;
    }

    private static Lot WithValuation(Lot l, Valuation v) => new()
    {
        Id = l.Id, CatalogueId = l.CatalogueId, RowKey = l.RowKey, LotNumber = l.LotNumber,
        Broker = l.Broker, Grade = l.Grade, Garden = l.Garden, Category = l.Category,
        Elevation = l.Elevation, Region = l.Region, Warehouse = l.Warehouse, Mark = l.Mark,
        SaleNo = l.SaleNo, SaleYear = l.SaleYear, InvoiceNo = l.InvoiceNo,
        NetWeight = l.NetWeight, GrossWeight = l.GrossWeight, RawData = l.RawData, Valuation = v,
    };

    private static string CellText(Lot lot, Catalogue catalogue, ColumnSpec spec) => spec.Kind switch
    {
        "raw" => lot.RawData.GetValueOrDefault(spec.Key, ""),
        "field" => ResolveField(lot, catalogue, spec.Key),
        _ => "",
    };

    private static string ResolveField(Lot lot, Catalogue catalogue, string key)
    {
        var v = lot.Valuation;
        return key switch
        {
            "sale" => catalogue.SourceName,
            "lotNo" => lot.LotNumber ?? "",
            "broker" => lot.Broker ?? "",
            "grade" => lot.Grade ?? "",
            "gardenMark" => lot.Garden ?? lot.Mark ?? "",
            "category" => lot.Category ?? "",
            "netWeight" => lot.NetWeight?.ToString("0.##") ?? "",
            "grossWeight" => lot.GrossWeight?.ToString("0.##") ?? "",
            // "valuation" is written as a number elsewhere; this text form is a fallback only.
            "valuation" => v?.EffectiveValue?.ToString("0.##") ?? "",
            "classification" => ClassificationLabel(v?.Classification),
            "standardData" => v?.StandardData ?? "",
            "adjectiveData" => v?.AdjectiveData ?? "",
            "liquorRemarks" => v?.LiquorRemarks ?? "",
            "musterReport" => v?.MusterReport ?? "",
            "brokerNotes" => v?.BrokerNotes ?? "",
            "privateNotes" => v?.PrivateNotes ?? "",
            _ => "",
        };
    }

    private static int WidthFor(ColumnSpec spec) => spec switch
    {
        { Kind: "field", Key: "standardData" or "liquorRemarks" or "adjectiveData" or "musterReport" or "brokerNotes" or "privateNotes" } => 24,
        { Kind: "field", Key: "sale" } => 16,
        { Kind: "field", Key: "valuation" } => 13,
        _ => 14,
    };

    private static (ICellStyle Title, ICellStyle Subtitle, ICellStyle Header, ICellStyle Cell, ICellStyle Currency) BuildStyles(XSSFWorkbook wb)
    {
        var titleStyle = wb.CreateCellStyle();
        var titleFont = wb.CreateFont();
        titleFont.FontHeightInPoints = 16;
        titleFont.IsBold = true;
        titleFont.Color = IndexedColors.White.Index;
        titleStyle.SetFont(titleFont);
        titleStyle.FillForegroundColor = IndexedColors.Black.Index;
        titleStyle.FillPattern = FillPattern.SolidForeground;
        titleStyle.Alignment = HorizontalAlignment.Center;

        var subtitleStyle = wb.CreateCellStyle();
        var subtitleFont = wb.CreateFont();
        subtitleFont.FontHeightInPoints = 10.5;
        subtitleFont.Color = IndexedColors.White.Index;
        subtitleStyle.SetFont(subtitleFont);
        subtitleStyle.FillForegroundColor = IndexedColors.Black.Index;
        subtitleStyle.FillPattern = FillPattern.SolidForeground;
        subtitleStyle.Alignment = HorizontalAlignment.Center;

        var headerStyle = wb.CreateCellStyle();
        var headerFont = wb.CreateFont();
        headerFont.IsBold = true;
        headerFont.Color = IndexedColors.White.Index;
        headerStyle.SetFont(headerFont);
        headerStyle.FillForegroundColor = IndexedColors.DarkYellow.Index;
        headerStyle.FillPattern = FillPattern.SolidForeground;
        headerStyle.BorderBottom = BorderStyle.Thin;
        headerStyle.Alignment = HorizontalAlignment.Center;
        headerStyle.WrapText = true;

        var cellStyle = wb.CreateCellStyle();
        cellStyle.BorderBottom = BorderStyle.Hair;
        cellStyle.VerticalAlignment = VerticalAlignment.Top;
        cellStyle.WrapText = true;

        var currencyStyle = wb.CreateCellStyle();
        currencyStyle.CloneStyleFrom(cellStyle);
        currencyStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0.00");
        currencyStyle.Alignment = HorizontalAlignment.Right;

        return (titleStyle, subtitleStyle, headerStyle, cellStyle, currencyStyle);
    }

    private static string ClassificationLabel(Classification? cls) => cls switch
    {
        Classification.SelectBest => "Select Best",
        Classification.Best => "Best",
        Classification.BelowBest => "Below Best",
        Classification.Poor => "Poor",
        _ => "Unclassified"
    };

    private static string SanitizeFileName(string name)
    {
        var noExt = Path.GetFileNameWithoutExtension(name);
        foreach (var c in Path.GetInvalidFileNameChars()) noExt = noExt.Replace(c, '_');
        return noExt.Replace(' ', '_');
    }
}
