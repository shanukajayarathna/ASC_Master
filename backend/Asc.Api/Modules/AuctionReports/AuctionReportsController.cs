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
public class AuctionReportsController(ICatalogueSource source, TopPriceEngine engine, CatalogueImportService importer) : ControllerBase
{
    [HttpGet("{catalogueId:guid}/combined")]
    public ActionResult<CombinedReportDto> Combined(Guid catalogueId)
    {
        var (catalogue, lots) = Resolve(catalogueId);
        if (catalogue is null || lots is null) return NotFound();
        return Ok(engine.BuildCombined(lots, catalogue.SourceName));
    }

    /// <summary>
    /// The upload-a-workbook path combined.html itself offers, for a sale not (yet) imported
    /// as a Catalogue — reuses CatalogueImportService's own header-fuzzy-matching/Lot-building
    /// pipeline (the same one every real weekly-sale import already goes through, see
    /// SaleFileStore), just without persisting anything: the parsed lots feed TopPriceEngine
    /// directly and are discarded once the response is built. No CatalogueId ever exists for
    /// this data, so IDs found this way are meaningless placeholders — nothing downstream reads
    /// them for an upload-sourced report.
    /// </summary>
    [HttpPost("from-upload/combined")]
    [RequestSizeLimit(100_000_000)]
    public ActionResult<CombinedReportDto> CombinedFromUpload(IFormFile file, [FromForm] string? saleNo)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".xlsx" or ".xls"))
            return BadRequest("Sale files are Excel files (.xlsx or .xls).");

        using var stream = file.OpenReadStream();
        var parsed = importer.ParseFile(stream, file.FileName);
        if (parsed.Rows.Count == 0) return BadRequest("Couldn't find a data table in this file — check it has a header row with Broker/Selling Mark/Grade/Purchased Price columns.");

        var lots = parsed.Rows.Select(row => importer.BuildLot(Guid.Empty, parsed.Headers, row)).ToList();
        var sourceName = string.IsNullOrWhiteSpace(saleNo) ? file.FileName : $"Sale {saleNo} — {file.FileName}";
        return Ok(engine.BuildCombined(lots, sourceName));
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

    private (Models.Catalogue? Catalogue, List<Models.Lot>? Lots) Resolve(Guid catalogueId)
    {
        var catalogue = source.GetCatalogue(catalogueId);
        var lots = source.GetLots(catalogueId);
        if (catalogue is null || lots is null) return (null, null);
        return (catalogue, [.. lots]);
    }
}
