using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.ScheduledReports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.Reports;

/// <summary>
/// Report generation — see Modules/Reports/ReportGenerator.cs for the actual computation.
/// PDF is deliberately not a backend concern here: the frontend renders the report and lets
/// the browser's own Print → Save as PDF handle it, exactly like the original vanilla-JS
/// Report Builder did. Every action requires login, same policy as every module built after
/// Phase 2.
/// </summary>
[ApiController]
[Route("api/v1/reports")]
[Authorize]
public class ReportsController(ReportGenerator generator, MongoContext db, IGeneratedReportFileStore fileStore) : ControllerBase
{
    [HttpGet("{catalogueId:guid}/{type}")]
    public async Task<ActionResult<ReportDto>> Generate(Guid catalogueId, string type)
    {
        if (!ReportGenerator.Types.Contains(type)) return BadRequest($"Unknown report type '{type}'.");
        var report = await generator.Generate(type, catalogueId);
        return report is null ? NotFound() : Ok(report);
    }

    [HttpGet("{catalogueId:guid}/{type}/excel")]
    public async Task<IActionResult> ExportExcel(Guid catalogueId, string type)
    {
        if (!ReportGenerator.Types.Contains(type)) return BadRequest($"Unknown report type '{type}'.");
        var report = await generator.Generate(type, catalogueId);
        if (report is null) return NotFound();

        using var wb = new XSSFWorkbook();
        var sheet = wb.CreateSheet("Report");
        var (titleStyle, subtitleStyle, headerStyle, cellStyle, currencyStyle) = ExportController.BuildStyles(wb);

        var rowIdx = 0;
        void MergedRow(string text, ICellStyle style, float height, int cols)
        {
            var row = sheet.CreateRow(rowIdx);
            row.HeightInPoints = height;
            for (var c = 0; c < cols; c++)
            {
                var cell = row.CreateCell(c);
                cell.CellStyle = style;
                if (c == 0) cell.SetCellValue(text);
            }
            if (cols > 1) sheet.AddMergedRegion(new NPOI.SS.Util.CellRangeAddress(rowIdx, rowIdx, 0, cols - 1));
            rowIdx++;
        }

        MergedRow("Asia Siyaka Commodities", titleStyle, 26f, 3);
        MergedRow($"{report.Title} — {report.SourceName}", subtitleStyle, 18f, 3);
        MergedRow($"{report.Subtitle} · Generated {report.GeneratedAt:dd MMM yyyy, HH:mm} UTC", subtitleStyle, 16f, 3);
        rowIdx++;

        foreach (var section in report.Sections)
        {
            var header = sheet.CreateRow(rowIdx++);
            header.CreateCell(0).SetCellValue(section.Title);
            header.GetCell(0).CellStyle = headerStyle;

            if (section.Kpis is { Count: > 0 })
            {
                foreach (var kpi in section.Kpis)
                {
                    var row = sheet.CreateRow(rowIdx++);
                    row.CreateCell(0).SetCellValue(kpi.Label);
                    row.GetCell(0).CellStyle = cellStyle;
                    var valueCell = row.CreateCell(1);
                    valueCell.CellStyle = kpi.Format == "currency" ? currencyStyle : cellStyle;
                    if (kpi.Value.HasValue) valueCell.SetCellValue((double)kpi.Value.Value);
                }
            }
            else if (section.Groups is { Count: > 0 })
            {
                var cols = new List<string> { section.GroupUnitLabel ?? "Label", "Lots" };
                if (section.Groups.Any(g => g.AverageValue.HasValue)) cols.Add("Average Valuation");
                if (section.Groups.Any(g => g.Percent.HasValue)) cols.Add("% of Total");

                var colHeader = sheet.CreateRow(rowIdx++);
                for (var c = 0; c < cols.Count; c++)
                {
                    var cell = colHeader.CreateCell(c);
                    cell.SetCellValue(cols[c]);
                    cell.CellStyle = headerStyle;
                }

                foreach (var g in section.Groups)
                {
                    var row = sheet.CreateRow(rowIdx++);
                    row.CreateCell(0).SetCellValue(g.Label);
                    row.GetCell(0).CellStyle = cellStyle;
                    row.CreateCell(1).SetCellValue(g.Count);
                    row.GetCell(1).CellStyle = cellStyle;
                    var c = 2;
                    if (cols.Contains("Average Valuation"))
                    {
                        var cell = row.CreateCell(c++);
                        cell.CellStyle = currencyStyle;
                        if (g.AverageValue.HasValue) cell.SetCellValue((double)g.AverageValue.Value);
                    }
                    if (cols.Contains("% of Total"))
                    {
                        var cell = row.CreateCell(c);
                        cell.CellStyle = cellStyle;
                        if (g.Percent.HasValue) cell.SetCellValue($"{g.Percent.Value:0.0}%");
                    }
                }
            }
            rowIdx++; // spacer between sections
        }

        for (var c = 0; c < 4; c++) sheet.SetColumnWidth(c, 20 * 256);

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{ExportController.SanitizeFileName(report.Title)}.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    [HttpGet("{catalogueId:guid}/{type}/pptx")]
    public async Task<IActionResult> ExportPresentation(Guid catalogueId, string type)
    {
        if (!ReportGenerator.Types.Contains(type)) return BadRequest($"Unknown report type '{type}'.");
        var report = await generator.Generate(type, catalogueId);
        if (report is null) return NotFound();

        var bytes = PresentationGenerator.Build(report);
        var fileName = $"{ExportController.SanitizeFileName(report.Title)}.pptx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileName);
    }

    [HttpPost("saved")]
    public async Task<ActionResult<SavedReportDto>> Save(SaveReportRequestDto dto, CancellationToken ct)
    {
        var saved = new SavedReport
        {
            Type = dto.Type,
            Title = dto.Title,
            CatalogueId = dto.CatalogueId,
            Source = dto.Source,
        };
        await db.SavedReports.InsertOneAsync(saved, cancellationToken: ct);
        return Ok(ToDto(saved));
    }

    [HttpGet("saved")]
    public async Task<ActionResult<List<SavedReportDto>>> ListSaved(CancellationToken ct)
    {
        var list = await db.SavedReports.Find(FilterDefinition<SavedReport>.Empty)
            .SortByDescending(r => r.CreatedAt).ToListAsync(ct);
        return Ok(list.Select(ToDto).ToList());
    }

    [HttpDelete("saved/{id:guid}")]
    public async Task<IActionResult> DeleteSaved(Guid id, CancellationToken ct)
    {
        await db.SavedReports.DeleteOneAsync(r => r.Id == id, ct);
        return NoContent();
    }

    /// <summary>Only reachable for a Downloadable SavedReportDto (StoredFileId set) — see
    /// IGeneratedReportFileStore's own doc comment. Every signed-in user can reach this, same
    /// as every other action in this controller and the same visibility ListSaved already
    /// gives every saved report's metadata.</summary>
    [HttpGet("saved/{id:guid}/download")]
    public async Task<IActionResult> DownloadSaved(Guid id, CancellationToken ct)
    {
        var report = await db.SavedReports.Find(r => r.Id == id).FirstOrDefaultAsync(ct);
        if (report?.StoredFileId is not { } fileId) return NotFound();

        var file = fileStore.Get(fileId);
        if (file is null) return NotFound();

        return PhysicalFile(file.Value.Path, file.Value.ContentType, file.Value.FileName);
    }

    private static SavedReportDto ToDto(SavedReport r) =>
        new(r.Id, r.Type, r.Title, r.CatalogueId, r.Source, r.CreatedAt, r.StoredFileId.HasValue, r.Notes);
}
