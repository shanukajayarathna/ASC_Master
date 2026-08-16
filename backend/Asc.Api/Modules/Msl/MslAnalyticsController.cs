using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

public record SaleStatRowDto(
    string Key, string? Label, long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg,
    decimal ProceedsRs, decimal? AvgPriceRs, decimal? MinPriceRs, decimal? MaxPriceRs);

public record SaleSummaryDto(
    int Year, int SaleNo, DateTime SaleDate, long Lots, long SoldLots,
    decimal TotalQtyKg, decimal SoldQtyKg, decimal ProceedsRs, decimal? AvgPriceRs);

public record SaleAnalyticsDto(
    int Year, int SaleNo, DateTime SaleDate, bool IsPrivateBucket,
    SaleStatRowDto Total,
    List<SaleStatRowDto> Brokers,
    List<SaleStatRowDto> Elevations,
    List<SaleStatRowDto> Grades,
    List<SaleStatRowDto> Buyers,
    List<SaleStatRowDto> Marks,
    List<SaleStatRowDto> PriceRanges,
    List<SaleSummaryDto> RecentSales);

/// <summary>
/// The Analysis screen's data source — everything reads the materialized mslSaleStats
/// rollups, so responses are a few hundred small documents regardless of archive size.
/// One payload per sale carries every dimension: pre-auction (catalogue composition) and
/// post-auction (sold/proceeds/averages) views are the same rows read differently.
/// </summary>
[ApiController]
[Route("api/v1/msl/analytics")]
[Authorize]
public class MslAnalyticsController(MongoContext db, MslExcelExportService exports, MslReportExportService reportExports) : ControllerBase
{
    /// <summary>Turns any table shown in the chat into a real .xlsx — headers + string
    /// rows in, workbook out. The rows come from the chat's rendered table, which itself
    /// was pasted verbatim from tool output, so the file carries exactly the figures the
    /// user saw.</summary>
    public record TableExportRequest(string? FileName, string? Title, List<string> Headers, List<List<string>> Rows);

    [HttpPost("export/table")]
    public IActionResult ExportTable([FromBody] TableExportRequest req)
    {
        if (req.Headers is not { Count: > 0 } || req.Rows is null) return BadRequest("Headers and rows are required.");
        if (req.Rows.Count > 5000) return BadRequest("Too many rows (max 5,000).");
        var wb = new NPOI.XSSF.UserModel.XSSFWorkbook();
        var ws = wb.CreateSheet("Data");
        var headerStyle = wb.CreateCellStyle();
        var font = wb.CreateFont();
        font.IsBold = true;
        font.Color = NPOI.HSSF.Util.HSSFColor.White.Index;
        headerStyle.SetFont(font);
        headerStyle.FillForegroundColor = NPOI.HSSF.Util.HSSFColor.DarkBlue.Index;
        headerStyle.FillPattern = NPOI.SS.UserModel.FillPattern.SolidForeground;
        int r = 0;
        if (!string.IsNullOrWhiteSpace(req.Title))
            ws.CreateRow(r++).CreateCell(0).SetCellValue(req.Title);
        var hr = ws.CreateRow(r++);
        for (int c = 0; c < req.Headers.Count; c++)
        {
            var cell = hr.CreateCell(c);
            cell.SetCellValue(req.Headers[c]);
            cell.CellStyle = headerStyle;
        }
        foreach (var row in req.Rows)
        {
            var xr = ws.CreateRow(r++);
            for (int c = 0; c < row.Count; c++)
            {
                var raw = row[c];
                // Numbers travel as text in the table — store numerics as numbers so
                // Excel can sum/sort them.
                var cleaned = raw.Replace(",", "");
                if (decimal.TryParse(cleaned, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var num)
                    && cleaned.Length > 0 && (char.IsDigit(cleaned[0]) || cleaned[0] == '-'))
                    xr.CreateCell(c).SetCellValue((double)num);
                else
                    xr.CreateCell(c).SetCellValue(raw);
            }
        }
        for (int c = 0; c < req.Headers.Count; c++) ws.SetColumnWidth(c, Math.Min(40, Math.Max(12, req.Headers[c].Length + 6)) * 256);
        ws.CreateFreezePane(0, string.IsNullOrWhiteSpace(req.Title) ? 1 : 2);
        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        var name = string.IsNullOrWhiteSpace(req.FileName) ? "chat-table.xlsx" : req.FileName;
        if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) name += ".xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
    }

    /// <summary>Streams a workbook/PDF/deck the Analytics Agent generated — whichever store
    /// actually holds this id. Ids are one-time-ish: they expire ~20 minutes after generation.</summary>
    [HttpGet("export/{id}")]
    public IActionResult DownloadExport(string id)
    {
        var xlsx = exports.Get(id);
        if (xlsx is not null)
            return File(xlsx.Content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx.FileName);
        var other = reportExports.Get(id);
        if (other is not null)
            return File(other.Content, other.ContentType, other.FileName);
        return NotFound("This export has expired — ask the agent to generate it again.");
    }

    /// <summary>All sales for the pickers + weekly trend charts, newest first. SaleNo 0
    /// rows are a year's private-sales bucket.</summary>
    [HttpGet("sales")]
    public async Task<ActionResult<List<SaleSummaryDto>>> Sales([FromQuery] int? year, CancellationToken ct)
    {
        var fb = Builders<MslSaleStat>.Filter;
        var filter = fb.Eq(s => s.Dimension, "total");
        if (year is not null) filter &= fb.Eq(s => s.Year, year.Value);
        var rows = await db.MslSaleStats.Find(filter)
            .SortByDescending(s => s.Year).ThenByDescending(s => s.SaleNo)
            .ToListAsync(ct);
        return rows.Select(ToSummary).ToList();
    }

    [HttpGet("{year:int}/{saleNo:int}")]
    public async Task<ActionResult<SaleAnalyticsDto>> Sale(int year, int saleNo, CancellationToken ct)
    {
        var rows = await db.MslSaleStats
            .Find(s => s.Year == year && s.SaleNo == saleNo)
            .ToListAsync(ct);
        if (rows.Count == 0) return NotFound($"No data for sale {saleNo} of {year}.");

        var total = rows.First(r => r.Dimension == "total");

        // Context strip: this sale among its neighbours (previous ~12 by date).
        var recent = await db.MslSaleStats
            .Find(s => s.Dimension == "total" && s.SaleNo > 0 && s.SaleDate <= total.SaleDate)
            .SortByDescending(s => s.SaleDate)
            .Limit(13)
            .ToListAsync(ct);
        recent.Reverse();

        List<SaleStatRowDto> Dim(string d, int limit, bool byQty = true) =>
            rows.Where(r => r.Dimension == d)
                .OrderByDescending(r => byQty ? r.TotalQtyKg : r.ProceedsRs)
                .Take(limit)
                .Select(ToRow)
                .ToList();

        return new SaleAnalyticsDto(
            year, saleNo, total.SaleDate, saleNo == 0,
            ToRow(total),
            Dim("broker", 12),
            Dim("elevation", 8),
            Dim("grade", 60),
            Dim("buyer", 60),
            Dim("mark", 100),
            [.. rows.Where(r => r.Dimension == "priceRange").Select(ToRow)],
            recent.Select(ToSummary).ToList());
    }

    private static SaleStatRowDto ToRow(MslSaleStat s) => new(
        s.Key, s.Label, s.Lots, s.SoldLots, Math.Round(s.TotalQtyKg, 2), Math.Round(s.SoldQtyKg, 2),
        Math.Round(s.ProceedsRs, 2),
        s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : null,
        s.MinPriceRs, s.MaxPriceRs);

    private static SaleSummaryDto ToSummary(MslSaleStat s) => new(
        s.Year, s.SaleNo, s.SaleDate, s.Lots, s.SoldLots,
        Math.Round(s.TotalQtyKg, 2), Math.Round(s.SoldQtyKg, 2), Math.Round(s.ProceedsRs, 2),
        s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : null);
}
