using Asc.Api.Data;
using Asc.Api.Models;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using NPOI.SS.UserModel;
using NPOI.SS.Util;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Controllers;

[ApiController]
[Route("api/catalogues/{catalogueId:guid}/export")]
public class ExportController(MongoContext db) : ControllerBase
{
    public record ExportRequest(List<Guid> LotIds);

    private static readonly string[] ReportColumns =
    [
        "Lot No", "Broker", "Grade", "Garden / Mark", "Category",
        "Net Wt (kg)", "Gross Wt (kg)", "Valuation (Rs.)", "Classification", "Standard Data", "Liquor Remarks"
    ];

    [HttpPost("excel")]
    public async Task<IActionResult> ExportExcel(Guid catalogueId, ExportRequest req)
    {
        var catalogue = await db.Catalogues.Find(c => c.Id == catalogueId).FirstOrDefaultAsync();
        if (catalogue is null) return NotFound();

        var lots = await db.Lots.Find(l => l.CatalogueId == catalogueId && req.LotIds.Contains(l.Id)).ToListAsync();
        lots = lots.OrderBy(l => l.LotNumber, StringComparer.OrdinalIgnoreCase).ToList();

        using var wb = new XSSFWorkbook();
        var sheet = wb.CreateSheet("Lot Report");

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

        int lastCol = ReportColumns.Length - 1;
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
            sheet.AddMergedRegion(new CellRangeAddress(rowIdx, rowIdx, 0, lastCol));
            rowIdx++;
        }

        MergedRow("Asia Siyaka Commodities", titleStyle, 26f);
        MergedRow($"Tea Auction Lot Report — {catalogue.SourceName}", subtitleStyle, 18f);
        MergedRow($"Generated {DateTime.UtcNow:dd MMM yyyy, HH:mm} UTC · {lots.Count} lot(s)", subtitleStyle, 16f);
        rowIdx++; // blank spacer row

        var headerRow = sheet.CreateRow(rowIdx++);
        for (int c = 0; c < ReportColumns.Length; c++)
        {
            var cell = headerRow.CreateCell(c);
            cell.SetCellValue(ReportColumns[c]);
            cell.CellStyle = headerStyle;
        }

        foreach (var lot in lots)
        {
            var row = sheet.CreateRow(rowIdx++);
            var v = lot.Valuation;
            decimal? value = v?.ValuationSingle
                ?? (v?.ValuationFrom is not null && v?.ValuationTo is not null ? (v.ValuationFrom + v.ValuationTo) / 2 : v?.ValuationFrom);

            string[] values =
            [
                lot.LotNumber ?? "", lot.Broker ?? "", lot.Grade ?? "", lot.Garden ?? lot.Mark ?? "", lot.Category ?? "",
                lot.NetWeight?.ToString("0.##") ?? "", lot.GrossWeight?.ToString("0.##") ?? "",
                "", ClassificationLabel(v?.Classification), v?.StandardData ?? "", v?.LiquorRemarks ?? ""
            ];

            for (int c = 0; c < values.Length; c++)
            {
                var cell = row.CreateCell(c);
                if (c == 7)
                {
                    cell.CellStyle = currencyStyle;
                    if (value.HasValue) cell.SetCellValue((double)value.Value);
                }
                else
                {
                    cell.CellStyle = cellStyle;
                    cell.SetCellValue(values[c]);
                }
            }
        }

        int[] widths = [10, 14, 10, 16, 14, 11, 11, 13, 13, 22, 26];
        for (int c = 0; c <= lastCol; c++)
            sheet.SetColumnWidth(c, widths[Math.Min(c, widths.Length - 1)] * 256);

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{SanitizeFileName(catalogue.SourceName)}_lot_report.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
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
