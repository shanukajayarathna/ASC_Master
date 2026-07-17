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
                lot.Valuation = BuildValuation(rng, importedAt, row["Grade"]);
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

    /// <summary>Valuation drawn from the grade's own price window, ~85% single values and
    /// ~15% ranges, quoted the way the trade does — in multiples of 50 (usually) or 20.
    /// Classification set from the grade's contiguous cutoffs; every remark field left
    /// null so the columns stay available but empty.</summary>
    private static Valuation BuildValuation(Random rng, DateTime importedAt, string grade)
    {
        var bands = BandsFor(grade);
        int step = rng.NextDouble() < 0.7 ? 50 : 20;
        int baseValue = rng.Next(bands.Low / step, bands.High / step + 1) * step;
        decimal? single = null, from = null, to = null;
        int effective;
        if (rng.NextDouble() < 0.15)
        {
            int span = step * rng.Next(1, 5); // 50..200 or 20..80, keeping both ends on the step
            int f = Math.Max(bands.Low, Math.Min(baseValue, bands.High - span));
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
            Classification = ClassificationFor(bands, effective),
            UpdatedAt = importedAt.AddHours(rng.Next(4, 41)).AddMinutes(rng.Next(60)),
        };
    }

    /// <summary>A grade's price window and its three tier cutoffs.</summary>
    private readonly record struct GradeBands(int Low, int High, int PoorTop, int BelowTop, int BestTop);

    /// <summary>
    /// Each grade trades in its own price neighbourhood (not the full 500–5000), and its
    /// window splits into four *contiguous* classification bands — Poor | BelowBest |
    /// Best | SelectBest with shared cutoffs and no gaps, the way a taster's scale works
    /// (e.g. Poor below 800, BelowBest 800–1200, Best 1200–1600, SelectBest above).
    /// Derived from a stable per-grade hash (string.GetHashCode is randomized per
    /// process) so re-seeding reproduces identical windows.
    /// </summary>
    private static GradeBands BandsFor(string grade)
    {
        int h = 17;
        foreach (var ch in grade) h = unchecked(h * 31 + ch);
        h = Math.Abs(h);

        int low = 500 + h % 12 * 250;                              // 500..3250
        int high = Math.Min(low + 1200 + h / 12 % 5 * 300, 5000);  // 1200..2400 wide
        int span = high - low;

        int poorTop = RoundTo50(low + span * 25 / 100);
        int belowTop = RoundTo50(low + span * 55 / 100);
        int bestTop = RoundTo50(low + span * 80 / 100);
        return new(low, high, poorTop, belowTop, bestTop);
    }

    private static int RoundTo50(int v) => (int)Math.Round(v / 50.0) * 50;

    private static Classification ClassificationFor(GradeBands b, int value) =>
        value <= b.PoorTop ? Classification.Poor
        : value <= b.BelowTop ? Classification.BelowBest
        : value <= b.BestTop ? Classification.Best
        : Classification.SelectBest;
}
