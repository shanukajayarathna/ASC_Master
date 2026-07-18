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
        var columnMeta = importer.RefreshDefaultVisibility(c.ColumnMeta);
        return Ok(new CatalogueDetailDto(c.Id, c.SourceName, c.Headers, columnMeta, c.RowCount, c.ImportedAt));
    }

    /// <summary>
    /// Per-grade classification history used by the Valuation Centre's auto-classification:
    /// for every grade, the classification tiers of the most recent *previous* sale that
    /// classified that grade — each tier's lot count, share of the grade (percent) and its
    /// value band. Bands form one contiguous scale per grade (each tier ends exactly where
    /// the next begins — no gaps), like a taster's cutoffs. Grades absent from the
    /// immediately previous sale fall back to the nearest earlier sale that has them.
    /// </summary>
    [HttpGet("{id:guid}/previous-grade-stats")]
    public async Task<ActionResult<PreviousGradeStatsDto>> PreviousGradeStats(Guid id)
    {
        var current = await db.Catalogues.Find(x => x.Id == id).FirstOrDefaultAsync();
        if (current is null) return NotFound();

        // Previous sales = catalogues imported before this one, newest first.
        var previous = await db.Catalogues
            .Find(c => c.Id != id && c.ImportedAt < current.ImportedAt)
            .SortByDescending(c => c.ImportedAt)
            .ToListAsync();

        // Quality rank for display order: the enum's numeric values aren't ranked
        // (SelectBest is 4 for storage-compat reasons but sits above Best).
        static int Rank(Classification c) => c switch
        {
            Classification.SelectBest => 4,
            Classification.Best => 3,
            Classification.BelowBest => 2,
            _ => 1,
        };

        var grades = new Dictionary<string, GradeStatsDto>(StringComparer.OrdinalIgnoreCase);
        foreach (var sale in previous)
        {
            // Only valued lots matter here, and real market catalogues run ~12k lots per
            // sale of which ~15% carry a valuation — filter server-side, not in memory.
            var lots = await db.Lots.Find(l => l.CatalogueId == sale.Id && l.Valuation != null).ToListAsync();
            var usable = lots.Where(l =>
                !string.IsNullOrWhiteSpace(l.Grade) &&
                l.Valuation is { Classification: not Classification.Unclassified } &&
                l.Valuation.EffectiveValue.HasValue);

            foreach (var grade in usable.GroupBy(l => l.Grade!.Trim(), StringComparer.OrdinalIgnoreCase))
            {
                // A newer sale already supplied this grade — keep the more recent history.
                if (grades.ContainsKey(grade.Key)) continue;

                var total = grade.Count();
                // Observed spread per tier, cheapest first. Min/max come from the values
                // as quoted (a range lot spans its From–To ends); the average of effective
                // values is the tier's center used for auto-classification.
                var raw = grade
                    .GroupBy(l => l.Valuation!.Classification)
                    .Select(t => new
                    {
                        Cls = t.Key,
                        Count = t.Count(),
                        Min = t.Min(l => l.Valuation!.ValuationFrom ?? l.Valuation!.ValuationSingle ?? l.Valuation!.EffectiveValue!.Value),
                        Max = t.Max(l => l.Valuation!.ValuationTo ?? l.Valuation!.ValuationSingle ?? l.Valuation!.EffectiveValue!.Value),
                        Avg = Math.Round(t.Average(l => l.Valuation!.EffectiveValue!.Value)),
                    })
                    .OrderBy(t => t.Avg)
                    .ToList();

                // Stitch the tiers into one contiguous scale — each classification ends
                // exactly where the next begins (Poor below X, BelowBest X–Y, Best Y–Z,
                // SelectBest above Z), the way a taster's cutoffs work. A shared boundary
                // is the midpoint of the gap between neighbouring tiers' observed values,
                // on a round figure, clamped so the scale never runs backwards even on
                // messy real data.
                var bounds = new decimal[raw.Count + 1];
                bounds[0] = raw[0].Min;
                bounds[raw.Count] = raw[^1].Max;
                for (int i = 1; i < raw.Count; i++)
                {
                    var mid = Math.Round((raw[i - 1].Max + raw[i].Min) / 20) * 10;
                    bounds[i] = Math.Clamp(mid, bounds[i - 1], bounds[raw.Count]);
                }

                var tiers = raw
                    .Select((t, i) => (t, lo: bounds[i], hi: bounds[i + 1]))
                    .OrderByDescending(x => Rank(x.t.Cls))
                    .Select(x => new GradeTierStatsDto(
                        x.t.Cls.ToString(),
                        x.t.Count,
                        Math.Round(x.t.Count * 100.0 / total, 1),
                        x.lo,
                        x.hi,
                        x.t.Avg))
                    .ToList();
                grades[grade.Key] = new GradeStatsDto(sale.SourceName, total, tiers);
            }
        }

        return Ok(new PreviousGradeStatsDto(grades));
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
