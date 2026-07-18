using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

/// <summary>
/// Catalogues are file-backed: the weekly-sale Excel files in data/sales ARE the store
/// (see SaleFileStore), auto-discovered on every listing. Uploading a new sale through
/// the app simply saves the file into that folder.
/// </summary>
[ApiController]
[Route("api/catalogues")]
public class CataloguesController(ICatalogueSource source, SaleFileStore fileStore, MongoContext db, CatalogueImportService importer) : ControllerBase
{
    [HttpGet]
    public ActionResult<List<CatalogueSummaryDto>> List()
    {
        var items = source.ListCatalogues();
        return Ok(items.Select(c => new CatalogueSummaryDto(c.Id, c.SourceName, c.RowCount, c.Headers.Count, c.ImportedAt)).ToList());
    }

    [HttpGet("{id:guid}")]
    public ActionResult<CatalogueDetailDto> Get(Guid id)
    {
        var c = source.GetCatalogue(id);
        if (c is null) return NotFound();
        var columnMeta = importer.RefreshDefaultVisibility(c.ColumnMeta);
        return Ok(new CatalogueDetailDto(c.Id, c.SourceName, c.Headers, columnMeta, c.RowCount, c.ImportedAt));
    }

    [HttpDelete("{id:guid}")]
    public IActionResult Delete(Guid id)
    {
        // Catalogues mirror the files on disk — deleting one through the app would mean
        // deleting a source data file, which stays a deliberate manual act.
        return BadRequest("Catalogues are file-backed: remove the sale's Excel file from data/sales instead.");
    }

    /// <summary>
    /// "Import" = save the uploaded weekly-sale file into data/sales. The filename must
    /// carry the sale number (e.g. 31.xlsx), matching the files already there; the sale
    /// then loads like any other. Re-uploading a sale's file replaces it.
    /// </summary>
    [HttpPost("import")]
    [RequestSizeLimit(100_000_000)]
    public async Task<ActionResult<CatalogueDetailDto>> Import(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest("No file uploaded.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".xlsx" or ".xls"))
            return BadRequest("Weekly sale files are Excel files (.xlsx or .xls).");

        var digits = new string(Path.GetFileNameWithoutExtension(file.FileName).Where(char.IsDigit).ToArray());
        if (digits.Length is 0 or > 3 || !int.TryParse(digits, out var saleNo))
            return BadRequest("Name the file by its sale number (e.g. 31.xlsx) so it slots into the weekly sequence.");

        Directory.CreateDirectory(fileStore.SalesDir);
        var target = Path.Combine(fileStore.SalesDir, $"{saleNo:00}{ext}");
        await using (var stream = System.IO.File.Create(target))
        {
            await file.CopyToAsync(stream);
        }

        var catalogue = source.GetCatalogue(SaleFileStore.CatalogueIdFor(saleNo));
        if (catalogue is null) return BadRequest("The uploaded file couldn't be parsed as a sale catalogue.");
        return Ok(new CatalogueDetailDto(catalogue.Id, catalogue.SourceName, catalogue.Headers, catalogue.ColumnMeta, catalogue.RowCount, catalogue.ImportedAt));
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
    public async Task<ActionResult<PreviousGradeStatsDto>> PreviousGradeStats(Guid id, [FromServices] IMemoryCache cache)
    {
        var current = source.GetCatalogue(id);
        if (current is null) return NotFound();

        // Previous sales are finished history — their stats don't change under a sale
        // being valued, so a short cache makes every page load after the first instant.
        var cacheKey = $"prev-grade-stats:{id}";
        if (cache.TryGetValue<PreviousGradeStatsDto>(cacheKey, out var cached) && cached is not null)
            return Ok(cached);

        // Previous sales = catalogues dated before this one, newest first.
        var previous = source.ListCatalogues()
            .Where(c => c.Id != id && c.ImportedAt < current.ImportedAt)
            .OrderByDescending(c => c.ImportedAt)
            .ToList();

        // User-entered valuations override the file-derived history they refine.
        var previousIds = previous.Select(c => c.Id).ToList();
        var overrides = (await db.Valuations.Find(v => previousIds.Contains(v.CatalogueId)).ToListAsync())
            .ToLookup(v => v.CatalogueId);

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
            var ovs = overrides[sale.Id].ToDictionary(v => v.LotId, v => v.Valuation);
            var usable = source.GetValuedSlim(sale.Id)
                .Select(l => (l.Grade, Valuation: ovs.GetValueOrDefault(l.LotId, l.Valuation)))
                .Where(l =>
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

        var dto = new PreviousGradeStatsDto(grades);
        cache.Set(cacheKey, dto, TimeSpan.FromMinutes(10));
        return Ok(dto);
    }
}
