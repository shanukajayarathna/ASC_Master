using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

/// <summary>
/// Development-only tooling for the company's real weekly-sale files kept in data/sales —
/// one Excel file per sale, named by sale number (01.xlsx … 29.xlsx). Inspection is a
/// read-only dry run of the production parser; import replaces the entire catalogue store
/// with the real sales. The files themselves are never modified.
/// </summary>
[ApiController]
[Route("api/dev")]
public class DevSeedController(MongoContext db, CatalogueImportService importer, IWebHostEnvironment env) : ControllerBase
{
    /// <summary>Sale 28 runs in the next auction week; every sale is anchored a week apart from it.</summary>
    private static readonly DateTime Sale28Date = new(2026, 7, 21, 9, 30, 0, DateTimeKind.Utc);

    private string SalesDir() =>
        Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "data", "sales"));

    /// <summary>
    /// Dry-run inspection of the real weekly-sale files: parses each with the production
    /// parser and reports row counts, valuation formats/ranges, grades and a sample valued
    /// row — used to design and sanity-check the header mapping. Reads only.
    /// </summary>
    [HttpGet("inspect-sales")]
    public IActionResult InspectSales()
    {
        if (!env.IsDevelopment()) return NotFound();
        var dir = SalesDir();
        if (!Directory.Exists(dir)) return NotFound($"No such folder: {dir}");

        var reports = new List<object>();
        foreach (var file in Directory.GetFiles(dir).OrderBy(f => f))
        {
            try
            {
                using var stream = System.IO.File.OpenRead(file);
                var parsed = importer.ParseFile(stream, Path.GetFileName(file));

                var valued = parsed.Rows.Where(r => !string.IsNullOrWhiteSpace(r.GetValueOrDefault("Valuation"))).ToList();
                var valuationNumbers = valued
                    .SelectMany(r => r["Valuation"].Split('-', '/'))
                    .Select(s => decimal.TryParse(s.Trim().Replace(",", ""), out var d) ? d : (decimal?)null)
                    .Where(d => d.HasValue).Select(d => d!.Value).ToList();
                var grades = valued.Select(r => r.GetValueOrDefault("Grade", "")).Where(g => g != "").ToList();
                reports.Add(new
                {
                    File = Path.GetFileName(file),
                    Rows = parsed.Rows.Count,
                    ValuedRows = valued.Count,
                    ValuationSamples = valued.Select(r => r["Valuation"]).Distinct().Take(10).ToList(),
                    ValuationMin = valuationNumbers.Count == 0 ? (decimal?)null : valuationNumbers.Min(),
                    ValuationMax = valuationNumbers.Count == 0 ? (decimal?)null : valuationNumbers.Max(),
                    GradeCount = grades.Distinct().Count(),
                    TopGrades = grades.GroupBy(g => g).OrderByDescending(g => g.Count()).Take(6).Select(g => $"{g.Key} x{g.Count()}").ToList(),
                    Brokers = valued.Select(r => r.GetValueOrDefault("Broker", "")).Distinct().Take(5).ToList(),
                    SampleValued = valued.FirstOrDefault(),
                });
            }
            catch (Exception ex)
            {
                reports.Add(new { File = Path.GetFileName(file), Error = ex.Message });
            }
        }
        return Ok(reports);
    }

    /// <summary>
    /// Imports the real weekly sales from data/sales into the catalogue store. Each file
    /// becomes one catalogue ("Sale N - 2026", dated weekly around the Sale 28 anchor).
    /// Incremental by default: sales already fully imported are skipped, partially
    /// imported ones (from an interrupted run) are healed by re-import, and new files —
    /// the next week's sale — are picked up; pass ?replace=true to wipe and redo
    /// everything. Rows without a Lot No (unit sub-headers, footers) are skipped. Lots
    /// with a Valuation cell get a real Valuation, and — since the files carry no
    /// classification column — history gets a one-time per-grade backfill so the
    /// Valuation Centre's auto-classification has bands to learn from.
    /// </summary>
    [HttpPost("import-sales")]
    public async Task<IActionResult> ImportSales([FromQuery] bool replace = false)
    {
        if (!env.IsDevelopment()) return NotFound();
        var dir = SalesDir();
        if (!Directory.Exists(dir)) return NotFound($"No such folder: {dir}");

        if (replace)
        {
            // Full replacement: the real files are the source of truth for every sale, so
            // all existing catalogues — seeds and earlier partial imports alike — go.
            await db.Lots.DeleteManyAsync(_ => true);
            await db.Catalogues.DeleteManyAsync(_ => true);
            await db.FilterPresets.DeleteManyAsync(_ => true);
            await db.ActualPrices.DeleteManyAsync(_ => true);
        }

        var existing = await db.Catalogues.Find(_ => true).ToListAsync();
        var summaries = new List<object>();
        foreach (var file in Directory.GetFiles(dir, "*.xls*").OrderBy(f => f))
        {
            if (!int.TryParse(Path.GetFileNameWithoutExtension(file), out var saleNo)) continue;

            var sourceName = $"Sale {saleNo} - 2026";
            var already = existing.FirstOrDefault(c => c.SourceName == sourceName);
            if (already is not null)
            {
                var lotCount = await db.Lots.CountDocumentsAsync(l => l.CatalogueId == already.Id);
                if (lotCount == already.RowCount)
                {
                    summaries.Add(new { SourceName = sourceName, Skipped = true });
                    continue;
                }
                // Interrupted mid-insert last time — drop the partial sale and redo it.
                await db.Lots.DeleteManyAsync(l => l.CatalogueId == already.Id);
                await db.Catalogues.DeleteOneAsync(c => c.Id == already.Id);
            }

            using var stream = System.IO.File.OpenRead(file);
            var parsed = importer.ParseFile(stream, Path.GetFileName(file));
            var rows = parsed.Rows.Where(r => !string.IsNullOrWhiteSpace(r.GetValueOrDefault("Lot No"))).ToList();

            var importedAt = Sale28Date.AddDays((saleNo - 28) * 7);
            var catalogue = new Catalogue
            {
                SourceName = $"Sale {saleNo} - 2026",
                Headers = parsed.Headers,
                RowCount = rows.Count,
                ColumnMeta = importer.BuildColumnMeta(parsed.Headers, rows),
                ImportedAt = importedAt,
            };
            await db.Catalogues.InsertOneAsync(catalogue);

            var lots = rows.Select(row =>
            {
                var lot = importer.BuildLot(catalogue.Id, parsed.Headers, row);
                lot.SaleNo = saleNo.ToString();
                lot.SaleYear = "2026";
                lot.Valuation = ParseValuation(row.GetValueOrDefault("Valuation", ""), importedAt);
                return lot;
            }).ToList();

            var classified = BackfillClassifications(lots);

            foreach (var chunk in lots.Chunk(2000))
                await db.Lots.InsertManyAsync(chunk);

            summaries.Add(new
            {
                catalogue.SourceName,
                Lots = lots.Count,
                Valued = lots.Count(l => l.Valuation is not null),
                Classified = classified,
                ImportedAt = importedAt,
            });
        }
        return Ok(summaries);
    }

    /// <summary>"900" or "1200-1300" (commas tolerated) → a Valuation; anything else → null.</summary>
    private static Valuation? ParseValuation(string raw, DateTime at)
    {
        var text = raw.Trim().Replace(",", "");
        if (text == "") return null;
        var parts = text.Split('-', StringSplitOptions.TrimEntries);
        if (parts.Length == 2 && decimal.TryParse(parts[0], out var from) && decimal.TryParse(parts[1], out var to) && from < to)
            return new Valuation { ValuationFrom = from, ValuationTo = to, UpdatedAt = at };
        return decimal.TryParse(text, out var single)
            ? new Valuation { ValuationSingle = single, UpdatedAt = at }
            : null;
    }

    /// <summary>
    /// The files carry the company's valuations but no classification column, so history
    /// gets a one-time backfill: within each grade, the valued lots split by value into
    /// the four tiers at the 25/55/80 percentiles (Poor | BelowBest | Best | SelectBest) —
    /// the same band proportions the taster's contiguous scale uses. Going forward, real
    /// classifications are entered in the Valuation Centre. Returns lots classified.
    /// </summary>
    private static int BackfillClassifications(List<Lot> lots)
    {
        int classified = 0;
        var valued = lots.Where(l => l.Valuation?.EffectiveValue is not null && !string.IsNullOrWhiteSpace(l.Grade));
        foreach (var grade in valued.GroupBy(l => l.Grade!.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var ordered = grade.OrderBy(l => l.Valuation!.EffectiveValue).ToList();
            for (int i = 0; i < ordered.Count; i++)
            {
                double pos = (i + 0.5) / ordered.Count;
                ordered[i].Valuation!.Classification =
                    pos < 0.25 ? Classification.Poor
                    : pos < 0.55 ? Classification.BelowBest
                    : pos < 0.80 ? Classification.Best
                    : Classification.SelectBest;
                classified++;
            }
        }
        return classified;
    }
}
