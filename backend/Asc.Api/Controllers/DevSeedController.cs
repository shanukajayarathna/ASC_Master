using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

/// <summary>
/// Development-only tooling for the file-backed catalogue store. The weekly-sale Excel
/// files in data/sales are the store itself (see SaleFileStore) — nothing here imports
/// them into a database anymore. The files are never modified.
/// </summary>
[ApiController]
[Route("api/dev")]
public class DevSeedController(MongoContext db, ICatalogueSource source, SaleFileStore fileStore, CatalogueImportService importer, IWebHostEnvironment env) : ControllerBase
{
    /// <summary>Quick diagnostics: what the database still holds, and which sales the file store sees.</summary>
    [HttpGet("db-info")]
    public IActionResult DbInfo()
    {
        if (!env.IsDevelopment()) return NotFound();
        var stats = db.Database.RunCommand<BsonDocument>(new BsonDocument("dbStats", 1));
        return Ok(new
        {
            Valuations = db.Valuations.CountDocuments(Builders<StoredValuation>.Filter.Empty),
            LegacyLots = db.LegacyLots.CountDocuments(Builders<Lot>.Filter.Empty),
            LegacyCatalogues = db.LegacyCatalogues.CountDocuments(Builders<Catalogue>.Filter.Empty),
            DataSizeMb = Math.Round(stats.GetValue("dataSize", 0).ToDouble() / 1_048_576, 1),
            Sales = source.ListCatalogues().Select(c => new { c.SourceName, c.RowCount }),
        });
    }

    /// <summary>
    /// Dry-run inspection of the weekly-sale files: parses each with the production parser
    /// and reports row counts, valuation formats/ranges and grades. Reads only.
    /// </summary>
    [HttpGet("inspect-sales")]
    public IActionResult InspectSales()
    {
        if (!env.IsDevelopment()) return NotFound();
        var dir = fileStore.SalesDir;
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
    /// Parses and caches every sale file that isn't cached yet (a full first-time pass
    /// over 30 market files takes ~10–15 minutes; after that everything is instant).
    /// Safe to re-run — up-to-date sales are skipped via the cache signature.
    /// </summary>
    [HttpPost("warm-file-cache")]
    public IActionResult WarmFileCache()
    {
        if (!env.IsDevelopment()) return NotFound();
        var warmed = new List<object>();
        foreach (var c in source.ListCatalogues().OrderBy(c => c.ImportedAt))
        {
            var slim = source.GetValuedSlim(c.Id);
            warmed.Add(new { c.SourceName, Valued = slim.Count });
        }
        return Ok(warmed);
    }

    /// <summary>
    /// Drops the legacy database-backed catalogue store (lots + catalogues collections,
    /// plus presets/prices keyed to their old ids) to reclaim the space that motivated
    /// the move to file-backed catalogues. User-entered valuations are untouched.
    /// </summary>
    [HttpPost("purge-mongo-catalogues")]
    public async Task<IActionResult> PurgeMongoCatalogues()
    {
        if (!env.IsDevelopment()) return NotFound();

        var lotCount = await db.LegacyLots.CountDocumentsAsync(Builders<Lot>.Filter.Empty);
        var catCount = await db.LegacyCatalogues.CountDocumentsAsync(Builders<Catalogue>.Filter.Empty);

        await db.Database.DropCollectionAsync("lots");
        await db.Database.DropCollectionAsync("catalogues");
        await db.Database.DropCollectionAsync("filterPresets");
        await db.Database.DropCollectionAsync("actualPrices");

        var stats = await db.Database.RunCommandAsync<BsonDocument>(new BsonDocument("dbStats", 1));
        return Ok(new
        {
            DroppedLots = lotCount,
            DroppedCatalogues = catCount,
            RemainingDataSizeMb = Math.Round(stats.GetValue("dataSize", 0).ToDouble() / 1_048_576, 1),
        });
    }
}
