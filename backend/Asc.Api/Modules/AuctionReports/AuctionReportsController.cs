using Asc.Api.Controllers;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.AuctionReports;

/// <summary>
/// "Combined Report" / Top Prices — cross-broker, per-grade price ranking for one sale, built
/// from real Lot.PurchasedPrice/Status/Category/Elevation data (see TopPriceEngine). Unlike
/// Modules/Reports, this doesn't touch ASC's own Valuation at all — it ranks the real auction
/// outcome for every broker in the file.
/// </summary>
[ApiController]
[Route("api/v1/auction-reports")]
[Authorize]
public class AuctionReportsController(ICatalogueSource source, TopPriceEngine engine, AuctionReportExcelBuilder excelBuilder) : ControllerBase
{
    [HttpGet("{catalogueId:guid}/combined")]
    public ActionResult<CombinedReportDto> Combined(Guid catalogueId)
    {
        var (catalogue, lots) = Resolve(catalogueId);
        if (catalogue is null || lots is null) return NotFound();
        return Ok(engine.BuildCombined(lots, catalogue.SourceName));
    }

    [HttpGet("{catalogueId:guid}/{reportKey}")]
    public ActionResult<AuctionReportDto> Generate(Guid catalogueId, string reportKey)
    {
        if (!TopPriceEngine.ReportKeys.Contains(reportKey)) return BadRequest($"Unknown report key '{reportKey}'.");
        var (catalogue, lots) = Resolve(catalogueId);
        if (catalogue is null || lots is null) return NotFound();

        var report = engine.Build(reportKey, lots, catalogue.SourceName);
        return report is null ? NotFound() : Ok(report);
    }

    [HttpGet("{catalogueId:guid}/{reportKey}/excel")]
    public ActionResult ExportExcel(Guid catalogueId, string reportKey)
    {
        if (!TopPriceEngine.ReportKeys.Contains(reportKey)) return BadRequest($"Unknown report key '{reportKey}'.");
        var (catalogue, lots) = Resolve(catalogueId);
        if (catalogue is null || lots is null) return NotFound();

        var report = engine.Build(reportKey, lots, catalogue.SourceName);
        if (report is null) return NotFound();

        using var wb = excelBuilder.Build(report);
        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{ExportController.SanitizeFileName(report.Title)}.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    [HttpGet("{catalogueId:guid}/combined/excel")]
    public ActionResult ExportCombinedExcel(Guid catalogueId)
    {
        var (catalogue, lots) = Resolve(catalogueId);
        if (catalogue is null || lots is null) return NotFound();

        var combined = engine.BuildCombined(lots, catalogue.SourceName);
        using var wb = excelBuilder.Build(combined);
        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{ExportController.SanitizeFileName($"Combined_Report_{catalogue.SourceName}")}.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    private (Models.Catalogue? Catalogue, List<Models.Lot>? Lots) Resolve(Guid catalogueId)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        var lots = source.GetLots(catalogueId);
        if (catalogue is null || lots is null) return (null, null);
        return (catalogue, [.. lots]);
    }
}
