using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

[ApiController]
[Route("api/catalogues")]
public class CataloguesController(MongoContext db, CatalogueImportService importer) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<CatalogueSummaryDto>>> List()
    {
        var items = await db.Catalogues.Find(_ => true).SortByDescending(c => c.ImportedAt).ToListAsync();
        return Ok(items.Select(c => new CatalogueSummaryDto(c.Id, c.SourceName, c.RowCount, c.Headers.Count, c.ImportedAt)).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<CatalogueDetailDto>> Get(Guid id)
    {
        var c = await db.Catalogues.Find(x => x.Id == id).FirstOrDefaultAsync();
        if (c is null) return NotFound();
        return Ok(new CatalogueDetailDto(c.Id, c.SourceName, c.Headers, c.ColumnMeta, c.RowCount, c.ImportedAt));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var result = await db.Catalogues.DeleteOneAsync(c => c.Id == id);
        if (result.DeletedCount == 0) return NotFound();

        // Mongo has no cascading delete — clean up dependent collections explicitly.
        await db.Lots.DeleteManyAsync(l => l.CatalogueId == id);
        await db.FilterPresets.DeleteManyAsync(p => p.CatalogueId == id);
        await db.ActualPrices.DeleteManyAsync(a => a.CatalogueId == id);

        return NoContent();
    }

    [HttpPost("import")]
    [RequestSizeLimit(100_000_000)]
    public async Task<ActionResult<CatalogueDetailDto>> Import(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");

        await using var stream = file.OpenReadStream();
        var parsed = importer.ParseFile(stream, file.FileName);
        if (parsed.Rows.Count == 0)
            return BadRequest("Couldn't find a usable table with a header row in this file.");

        var catalogue = new Catalogue
        {
            SourceName = file.FileName,
            Headers = parsed.Headers,
            RowCount = parsed.Rows.Count,
            ColumnMeta = importer.BuildColumnMeta(parsed.Headers, parsed.Rows)
        };
        await db.Catalogues.InsertOneAsync(catalogue);

        var lots = parsed.Rows.Select(row => importer.BuildLot(catalogue.Id, parsed.Headers, row)).ToList();
        if (lots.Count > 0) await db.Lots.InsertManyAsync(lots);

        return Ok(new CatalogueDetailDto(catalogue.Id, catalogue.SourceName, catalogue.Headers, catalogue.ColumnMeta, catalogue.RowCount, catalogue.ImportedAt));
    }
}
