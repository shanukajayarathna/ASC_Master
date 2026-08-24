using Asc.Api.Data;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>One factory's week/month-todate/year-todate figures — the database-computed
/// equivalent of a row from the WES master factory-wise sale workbook (see
/// frontend/src/lib/weeklyFactReport.ts's WesRow). Null pairs mean the factory held no
/// figure for that period (matches the WES sheet's blank cells).</summary>
public record WesFactoryRowDto(
    string Estate, string Code,
    decimal? WeekQtyKg, decimal? WeekAvgRs,
    decimal? MonthQtyKg, decimal? MonthAvgRs,
    decimal? YearQtyKg, decimal? YearAvgRs,
    int? WeekRank, int? MonthRank, int? YearRank);

public record WesEquivalentDto(
    int SaleNo, DateTime SaleDate,
    Dictionary<string, List<WesFactoryRowDto>> Categories,
    List<string> Warnings);

/// <summary>
/// Reproduces the WES master factory-wise sale workbook directly from the imported MSL
/// archive (auctionLots), as an alternative to uploading it by hand each week — verified
/// (16 Aug 2026) against real WES/RANK WISE archives for sale 30/2026: 568/571 week-level
/// factory rows exact across all 5 categories, year-to-date ~93% exact (small drift, likely
/// the post-auction price corrections already noted elsewhere in this codebase), rank
/// formula (dense rank by avg descending) exact. Only usable for sales already imported into
/// the database — callers must keep the manual WES upload as a fallback for a sale that
/// hasn't landed yet.
///
/// Two things aren't obvious from the raw TXT layout and had to be reverse engineered by
/// diffing against real archives:
///  1. The "reporting factory code" a WES row is keyed on is NOT the raw per-lot factory
///     code (AuctionLot.FactoryCode, e.g. "MFA1172"/"MFB1172") — it's the MSL code
///     (AuctionLot.MslCode) with its trailing 2-digit region suffix dropped. Two raw
///     sub-factory registrations sharing one MSL-code prefix collapse into ASC's single
///     reporting row (verified: MFA1172 + MFB1172 both carry MSL code "MF117236" and WES
///     reports them as one "VITHANAKANDA" row coded "MF1172").
///  2. A factory has ONE home elevation category for reporting purposes, even when a small
///     side-lot of its production carries a different class-code elevation prefix — that
///     lot's quantity still lands in the factory's home-elevation row, not a separate one
///     (verified: HAVENWEWA/MFD0878 sells almost entirely WESTERN MEDIUM tea but a 5,000kg
///     LOW-classed lot in sale 30 still counts toward its WESTERN MEDIUM total). Home
///     elevation here is whichever category holds the factory's largest year-to-date
///     quantity.
///
/// The heavy lifting (matching + summing a whole year of lots — up to several hundred
/// thousand documents by the back half of the year) runs as a MongoDB aggregation, grouped
/// by (reporting factory code, elevation) server-side, the same way MslFilteredAnalyticsController's
/// $facet pass does for the Analysis screen. Only one row per (factory, elevation) pair — a
/// few hundred to a couple thousand, never the raw lot count — crosses the wire; the C# side
/// then folds each factory's elevation sub-groups into its home elevation and does the
/// (small, cheap) ranking pass. An earlier version pulled every raw lot into the app and
/// grouped in LINQ: 5-27s for a single sale depending on how far into the year it fell, slow
/// enough to be genuinely fragile (this machine can lose a long-running dotnet process under
/// memory pressure — see [[docker-env-setup]]/ui-smoke-test-workflow) for what's meant to be
/// a button click, not a background job. Results are additionally cached per
/// (year, saleNo, DataVersion) like the rest of the MSL analytics layer, so a repeat request
/// for the same sale is instant.
/// </summary>
public class MslWeeklyReportService(MongoContext db, MslImportService importer, IMemoryCache cache)
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    private static readonly Dictionary<string, string> ElevationNames = new()
    {
        ["11"] = "UVA HIGH",
        ["12"] = "WESTERN HIGH",
        ["21"] = "UVA MEDIUM",
        ["22"] = "WESTERN MEDIUM",
        ["31"] = "LOW",
    };

    /// <summary>Distinct (year, saleNo, saleDate) sales whose SaleDate falls inside the given
    /// lookback window — the "which sales recently closed" query WeeklyFactAutoReportJob polls
    /// on every tick. There's no explicit "close" action anywhere in this app (see
    /// DeadlineEngine's own doc comment: Catalogue.ImportedAt already stands in as a sale's
    /// closure date for deadline tracking), so this reuses the same idea for the MSL/auction
    /// sale domain: a sale is "closed" once its own SaleDate has passed. Ordered oldest-closed
    /// first so a backlog (e.g. after downtime) drains in the order sales actually happened.</summary>
    public async Task<List<(int Year, int SaleNo, DateTime SaleDate)>> FindRecentlyClosedSalesAsync(
        TimeSpan lookback, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var stages = new List<MongoDB.Bson.BsonDocument>
        {
            // SaleNo 0 is the private-sale bucket, not a numbered weekly auction — Weekly
            // FACT has no meaning for it (see AuctionLot's own SaleNo doc comment).
            new("$match", new MongoDB.Bson.BsonDocument
            {
                ["d"] = new MongoDB.Bson.BsonDocument { ["$gte"] = now - lookback, ["$lt"] = now },
                ["s"] = new MongoDB.Bson.BsonDocument("$gt", 0),
            }),
            new("$group", new MongoDB.Bson.BsonDocument
            {
                ["_id"] = new MongoDB.Bson.BsonDocument { ["y"] = "$y", ["s"] = "$s" },
                ["saleDate"] = new MongoDB.Bson.BsonDocument("$first", "$d"),
            }),
            new("$sort", new MongoDB.Bson.BsonDocument("saleDate", 1)),
        };
        var docs = await db.AuctionLots.Aggregate<MongoDB.Bson.BsonDocument>(stages, cancellationToken: ct).ToListAsync(ct);
        return docs.Select(d =>
        {
            var id = d["_id"].AsBsonDocument;
            return (id["y"].AsInt32, id["s"].AsInt32, d["saleDate"].ToUniversalTime());
        }).ToList();
    }

    public Task<WesEquivalentDto?> BuildAsync(int year, int saleNo, CancellationToken ct)
    {
        var key = $"msl:weeklyreport:wes:{importer.DataVersion}:{year}:{saleNo}";
        return cache.GetOrCreateAsync(key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return await BuildUncachedAsync(year, saleNo, ct);
        })!;
    }

    private sealed record FactoryElevGroup(string Factory, string? Elevation, string Estate,
        decimal Qty, decimal Val, decimal MonthQty, decimal MonthVal, decimal WeekQty, decimal WeekVal);

    private async Task<WesEquivalentDto?> BuildUncachedAsync(int year, int saleNo, CancellationToken ct)
    {
        var saleDate = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo)
            .Project(l => l.SaleDate)
            .FirstOrDefaultAsync(ct);
        if (saleDate == default) return null;

        var warnings = new List<string>();
        var throughExclusive = saleDate.Date.AddDays(1); // sale's own day is inclusive
        var monthStart = new DateTime(saleDate.Year, saleDate.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var yearStart = new DateTime(saleDate.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var groups = await AggregateFactoryElevationsAsync(yearStart, throughExclusive, monthStart, saleNo, ct);
        if (groups.Count == 0) warnings.Add("No sold lots found in the database for this year.");

        var rows = new Dictionary<string, List<(string Code, WesFactoryRowDto Row)>>();
        foreach (var name in ElevationNames.Values) rows[name] = [];

        foreach (var factoryGroup in groups.GroupBy(g => g.Factory))
        {
            // Only sub-groups tagged with one of the 5 known elevation codes count toward a
            // home elevation — an unrecognised/missing code on a stray lot shouldn't crown
            // itself the winner just because nothing else claims that key.
            var known = factoryGroup.Where(g => g.Elevation is not null && ElevationNames.ContainsKey(g.Elevation)).ToList();
            if (known.Count == 0) continue;

            var home = known.OrderByDescending(g => g.Qty).First();
            var qty = known.Sum(g => g.Qty);
            var val = known.Sum(g => g.Val);
            var monthQty = known.Sum(g => g.MonthQty);
            var monthVal = known.Sum(g => g.MonthVal);
            var weekQty = known.Sum(g => g.WeekQty);
            var weekVal = known.Sum(g => g.WeekVal);

            decimal? YAvg() => qty > 0 ? Math.Round(val / qty, 2) : null;
            decimal? MAvg() => monthQty > 0 ? Math.Round(monthVal / monthQty, 2) : null;
            decimal? WAvg() => weekQty > 0 ? Math.Round(weekVal / weekQty, 2) : null;

            decimal? yQty = qty > 0 ? qty : null, mQty = monthQty > 0 ? monthQty : null, wQty = weekQty > 0 ? weekQty : null;
            if (wQty is null && mQty is null && yQty is null) continue;

            var row = new WesFactoryRowDto(home.Estate, factoryGroup.Key, wQty, WAvg(), mQty, MAvg(), yQty, YAvg(), null, null, null);
            rows[ElevationNames[home.Elevation!]].Add((factoryGroup.Key, row));
        }

        var categories = new Dictionary<string, List<WesFactoryRowDto>>();
        foreach (var (catName, catRows) in rows)
        {
            var weekRank = DenseRank(catRows, r => r.Row.WeekAvgRs);
            var monthRank = DenseRank(catRows, r => r.Row.MonthAvgRs);
            var yearRank = DenseRank(catRows, r => r.Row.YearAvgRs);
            // Dictionary<,>.GetValueOrDefault returns 0 (a real rank!) for a missing key, not
            // null — a row with no figure for a period must come back with no rank for it,
            // so this has to be a real TryGetValue, not the shorthand.
            static int? RankOf(Dictionary<string, int> ranks, string code) => ranks.TryGetValue(code, out var r) ? r : null;
            categories[catName] = catRows
                .Select(r => r.Row with
                {
                    WeekRank = RankOf(weekRank, r.Code),
                    MonthRank = RankOf(monthRank, r.Code),
                    YearRank = RankOf(yearRank, r.Code),
                })
                .ToList();
        }

        return new WesEquivalentDto(saleNo, saleDate, categories, warnings);
    }

    /// <summary>One row per (reporting factory code, elevation) pair for the year window —
    /// the MSL-code-minus-region-suffix computation (see class doc comment #1) runs as a
    /// $substrBytes so the grouping key itself never has to leave MongoDB.</summary>
    private async Task<List<FactoryElevGroup>> AggregateFactoryElevationsAsync(
        DateTime yearStart, DateTime throughExclusive, DateTime monthStart, int saleNo, CancellationToken ct)
    {
        var factoryCodeExpr = new BsonDocument("$cond", new BsonArray
        {
            new BsonDocument("$and", new BsonArray
            {
                new BsonDocument("$ne", new BsonArray { "$mc", BsonNull.Value }),
                new BsonDocument("$gt", new BsonArray
                {
                    new BsonDocument("$strLenBytes", new BsonDocument("$ifNull", new BsonArray { "$mc", "" })), 2,
                }),
            }),
            new BsonDocument("$substrBytes", new BsonArray
            {
                "$mc", 0, new BsonDocument("$subtract", new BsonArray { new BsonDocument("$strLenBytes", "$mc"), 2 }),
            }),
            "$f",
        });

        BsonDocument SumIf(BsonDocument cond, BsonValue whenTrue) =>
            new("$sum", new BsonDocument("$cond", new BsonArray { cond, whenTrue, 0 }));

        var isThisMonth = new BsonDocument("$gte", new BsonArray { "$d", monthStart });
        var isThisSale = new BsonDocument("$eq", new BsonArray { "$s", saleNo });
        var qtyPrice = new BsonDocument("$multiply", new BsonArray { "$q", "$p" });

        var stages = new List<BsonDocument>
        {
            new("$match", new BsonDocument { ["d"] = new BsonDocument { ["$gte"] = yearStart, ["$lt"] = throughExclusive }, ["so"] = true }),
            new("$addFields", new BsonDocument("fac", factoryCodeExpr)),
            new("$group", new BsonDocument
            {
                ["_id"] = new BsonDocument { ["fac"] = "$fac", ["el"] = "$el" },
                ["estate"] = new BsonDocument("$first", "$e"),
                ["qty"] = new BsonDocument("$sum", "$q"),
                ["val"] = new BsonDocument("$sum", qtyPrice),
                ["monthQty"] = SumIf(isThisMonth, "$q"),
                ["monthVal"] = SumIf(isThisMonth, qtyPrice),
                ["weekQty"] = SumIf(isThisSale, "$q"),
                ["weekVal"] = SumIf(isThisSale, qtyPrice),
            }),
        };

        var docs = await db.AuctionLots.Aggregate<BsonDocument>(stages, new AggregateOptions { AllowDiskUse = true }, ct).ToListAsync(ct);
        return docs.Select(d =>
        {
            var id = d["_id"].AsBsonDocument;
            var elev = id.TryGetValue("el", out var elVal) && !elVal.IsBsonNull ? elVal.AsString : null;
            var estate = d.TryGetValue("estate", out var estVal) && !estVal.IsBsonNull ? estVal.AsString : "";
            return new FactoryElevGroup(
                id["fac"].AsString, elev, estate,
                d["qty"].ToDecimal(), d["val"].ToDecimal(),
                d["monthQty"].ToDecimal(), d["monthVal"].ToDecimal(),
                d["weekQty"].ToDecimal(), d["weekVal"].ToDecimal());
        }).ToList();
    }

    /// <summary>Dense rank by average price descending — ties share a rank, next rank
    /// resumes at the row count (matches Excel/the archive's own rank column).</summary>
    private static Dictionary<string, int> DenseRank(List<(string Code, WesFactoryRowDto Row)> rows, Func<(string Code, WesFactoryRowDto Row), decimal?> avgOf)
    {
        var ranked = rows.Where(r => avgOf(r) is not null).OrderByDescending(avgOf).ToList();
        var result = new Dictionary<string, int>();
        decimal? prevAvg = null;
        int rank = 0, n = 0;
        foreach (var r in ranked)
        {
            n++;
            var avg = avgOf(r);
            if (avg != prevAvg) { rank = n; prevAvg = avg; }
            result[r.Code] = rank;
        }
        return result;
    }
}
