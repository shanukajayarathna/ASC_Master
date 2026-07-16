using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

/// <summary>
/// Development-only test-data seeding. Generates synthetic *previous* weekly sales
/// (Sale 24–27 of 2026) that mirror the structure of the real imported catalogue —
/// same 14 columns, same value formats — with every lot fully valued (500–5000 LKR,
/// single or range) and classified. All remark fields stay null; estate names are
/// invented, not real gardens. Re-running replaces previously seeded sales.
/// </summary>
[ApiController]
[Route("api/dev")]
public class DevSeedController(MongoContext db, CatalogueImportService importer, IWebHostEnvironment env) : ControllerBase
{
    // Plain ASCII separator: fancy separators mojibake too easily across encodings.
    private const string Dot = "-";

    private static readonly string[] Headers =
    [
        "Broker", "SaleNumber", "SaleYear", "LotNo", "Mark", "SellingMark", "InvoiceNo",
        "Grade", "NoOfChests", "WeightPerChest", "NettWeight", "GrossWeight", "Category",
        "StoreDescription",
    ];

    private static readonly string[] Grades =
    [
        "BOP", "BOPF", "BOP1", "BOP1A", "BOPA", "BOPSp", "BOPFSp", "BM", "FBOP",
        "FBOPF", "PEKOE", "OP", "OPA", "DUST", "DUST1", "FNGS", "BP", "FF1",
    ];

    private static readonly string[] Categories =
    [
        "EX-ESTATE", "HIGH & MEDIUM", "LEAFY", "SEMI LEAFY", "OFF GRADES",
        "D U S T S", "PREMIUM FLOWERY", "BOP1A",
    ];

    // Invented estates (SellingMark → Mark code) — deliberately not real gardens.
    private static readonly (string Estate, string Mark)[] Estates =
    [
        ("KELANIGLEN", "MF0112"), ("MISTVALE", "MF0247"), ("SILVERBROOK", "MF0323"),
        ("THORNCLIFF", "MF0408"), ("EMBERHURST", "MF0519"), ("RAVENFIELD", "MF0602"),
        ("GLENMORROW", "MF0688"), ("HALCYONDALE", "MF0731"), ("WYNDCREST", "MF0814"),
        ("ASHENVALE", "MF0906"), ("BRIARMOUNT", "MF1027"), ("COPPERLEIGH", "MF1138"),
        ("DUNMERE", "MF1244"), ("EVERGLADE", "MF1359"), ("FERNRIDGE", "MF1462"),
        ("GREYSTOKE", "MF1571"), ("HOLLYBANK", "MF1688"), ("IVYCOMBE", "MF1795"),
        ("JASPERHILL", "MF1846"), ("KINGSMEAD", "MF1953"), ("LARKSPUR", "MF2065"),
        ("MOORCROFT", "MF2174"), ("NIGHTINGALE", "MF2287"), ("OAKHAVEN", "MF2391"),
    ];

    private static readonly string[] Stores =
    [
        "EX ESTATE",
        "AS Stores, 95 Ela Road, Muthurajawella",
        "151,BIYAGAMA ROAD,KELANIYA",
        "220, PADILIYATHUDUWA RD, ENDERAMULLA",
        "97, Ela Road, Muthurajawela,Hendala",
        "26A, CTB WAREHOUSE,WELIKADAMULLA, ENDERAMULLA",
    ];

    private static readonly int[] ChestWeights = [40, 45, 48, 50, 52, 55, 56, 58, 60];
    private static readonly int[] ChestCounts = [5, 8, 10, 12, 15, 16, 20, 20, 20, 24, 25, 30, 32, 40];

    [HttpPost("seed-previous-sales")]
    public async Task<IActionResult> SeedPreviousSales()
    {
        if (!env.IsDevelopment()) return NotFound();

        var rng = new Random(20260716); // deterministic → re-runs produce identical data

        // Replace any previously seeded synthetic sales. Matched by prefix rather than the
        // exact display name so re-seeding also cleans up variants from earlier runs.
        var seededPattern = new MongoDB.Bson.BsonRegularExpression("^Sale 2[4-7] ");
        var old = await db.Catalogues.Find(Builders<Catalogue>.Filter.Regex(c => c.SourceName, seededPattern)).ToListAsync();
        if (old.Count > 0)
        {
            var ids = old.Select(c => c.Id).ToList();
            await db.Lots.DeleteManyAsync(l => ids.Contains(l.CatalogueId));
            await db.Catalogues.DeleteManyAsync(c => ids.Contains(c.Id));
        }

        // Weekly cadence walking back from the current sale (Sale 28, imported 2026-07-12).
        var baseDate = new DateTime(2026, 7, 12, 9, 30, 0, DateTimeKind.Utc);
        (int SaleNo, int LotCount, DateTime ImportedAt)[] plan =
        [
            (24, 583, baseDate.AddDays(-28)),
            (25, 612, baseDate.AddDays(-21)),
            (26, 547, baseDate.AddDays(-14)),
            (27, 629, baseDate.AddDays(-7)),
        ];

        var summaries = new List<object>();
        foreach (var (saleNo, lotCount, importedAt) in plan)
        {
            var rows = BuildRows(rng, saleNo, lotCount);
            var catalogue = new Catalogue
            {
                SourceName = $"Sale {saleNo} {Dot} 2026",
                Headers = Headers.ToList(),
                RowCount = rows.Count,
                ColumnMeta = importer.BuildColumnMeta(Headers.ToList(), rows),
                ImportedAt = importedAt,
            };
            await db.Catalogues.InsertOneAsync(catalogue);

            var lots = rows.Select(row =>
            {
                var lot = importer.BuildLot(catalogue.Id, Headers.ToList(), row);
                lot.Valuation = BuildValuation(rng, importedAt);
                return lot;
            }).ToList();
            await db.Lots.InsertManyAsync(lots);

            summaries.Add(new { catalogue.SourceName, Lots = lots.Count, ImportedAt = importedAt });
        }

        // The current sale should read as a sale from the database, not an uploaded file
        // name. Matches the original file name or any earlier "Sale 28 …" rename variant.
        var renameFilter = Builders<Catalogue>.Filter.Or(
            Builders<Catalogue>.Filter.Eq(c => c.SourceName, "cat 282026xls.xls"),
            Builders<Catalogue>.Filter.Regex(c => c.SourceName, new MongoDB.Bson.BsonRegularExpression("^Sale 28 ")));
        var rename = await db.Catalogues.UpdateManyAsync(
            renameFilter,
            Builders<Catalogue>.Update.Set(c => c.SourceName, $"Sale 28 {Dot} 2026"));

        return Ok(new { seeded = summaries, renamedCurrentSale = rename.ModifiedCount > 0 });
    }

    private static List<Dictionary<string, string>> BuildRows(Random rng, int saleNo, int lotCount)
    {
        var rows = new List<Dictionary<string, string>>(lotCount);
        for (int i = 1; i <= lotCount; i++)
        {
            var (estate, mark) = Estates[rng.Next(Estates.Length)];
            int chests = ChestCounts[rng.Next(ChestCounts.Length)];
            int wpc = ChestWeights[rng.Next(ChestWeights.Length)];
            int nett = chests * wpc;
            rows.Add(new Dictionary<string, string>
            {
                ["Broker"] = "AS",
                ["SaleNumber"] = saleNo.ToString("000"),
                ["SaleYear"] = "2026",
                ["LotNo"] = i.ToString("0000"),
                ["Mark"] = mark,
                ["SellingMark"] = estate,
                ["InvoiceNo"] = $"{rng.Next(1, 1000):0000}{"RABCD"[rng.Next(5)]}",
                ["Grade"] = Grades[rng.Next(Grades.Length)],
                ["NoOfChests"] = chests.ToString(),
                ["WeightPerChest"] = wpc.ToString(),
                ["NettWeight"] = nett.ToString(),
                ["GrossWeight"] = nett.ToString(),
                ["Category"] = Categories[rng.Next(Categories.Length)],
                ["StoreDescription"] = Stores[rng.Next(Stores.Length)],
            });
        }
        return rows;
    }

    /// <summary>Valuation in 500–5000: ~85% single values, ~15% ranges. Classification set;
    /// every remark field left null so the columns stay available but empty.</summary>
    private static Valuation BuildValuation(Random rng, DateTime importedAt)
    {
        int baseValue = rng.Next(50, 501) * 10; // 500..5000 in round tens
        decimal? single = null, from = null, to = null;
        int effective;
        if (rng.NextDouble() < 0.15)
        {
            int span = new[] { 50, 100, 150, 200 }[rng.Next(4)];
            int f = Math.Max(500, Math.Min(baseValue, 5000 - span));
            from = f;
            to = f + span;
            effective = f + span / 2;
        }
        else
        {
            single = baseValue;
            effective = baseValue;
        }

        return new Valuation
        {
            ValuationSingle = single,
            ValuationFrom = from,
            ValuationTo = to,
            Classification = ClassificationFor(rng, effective),
            UpdatedAt = importedAt.AddHours(rng.Next(4, 41)).AddMinutes(rng.Next(60)),
        };
    }

    /// <summary>Higher-valued teas skew toward better tiers, like a real valuation book.</summary>
    private static Classification ClassificationFor(Random rng, int value)
    {
        double q = (value - 500) / 4500.0;
        double r = rng.NextDouble();
        if (q > 0.75) return r < 0.45 ? Classification.SelectBest : Classification.Best;
        if (q > 0.45) return r < 0.65 ? Classification.Best : r < 0.92 ? Classification.BelowBest : Classification.SelectBest;
        if (q > 0.2) return r < 0.6 ? Classification.BelowBest : r < 0.85 ? Classification.Best : Classification.Poor;
        return r < 0.55 ? Classification.Poor : Classification.BelowBest;
    }
}
