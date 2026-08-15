using System.Text.RegularExpressions;
using Asc.Api.Data;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

public record AuctionLotDto(
    int SaleYear, int SaleNo, DateTime SaleDate, string? Broker, string? BrokerName,
    bool IsPrivate, string LotNo, string? Invoice, string FactoryCode, string SellingMark,
    string Grade, decimal QuantityKg, decimal PriceRs, bool Sold, string? BuyerCode,
    string? BuyerName, string EstateName, string? MslCode, string? ElevationCode,
    string? Elevation, bool RefuseTea);

public record MslSearchAggregateDto(
    long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg, decimal? WeightedAvgRs,
    decimal? MinPriceRs, decimal? MaxPriceRs);

public record MslSearchResultDto(List<AuctionLotDto> Items, long Total, MslSearchAggregateDto Aggregate);

public record MslAggregateRowDto(
    string Key, long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg,
    decimal? WeightedAvgRs, decimal? MinPriceRs, decimal? MaxPriceRs);

public record MslYearStatDto(int Year, int Sales, long Lots);

public record MslStatusDto(
    string? DataPath, long TotalLots, long PrivateLots, int TrackedFiles, int FilesWithErrors,
    DateTime? LastScanAt, MslScanSummary? LastScan, List<MslYearStatDto> Years, int TeaBoardMonths);

public record SaleComparisonDiffDto(
    string Broker, string LotNo, string SellingMark, string Grade,
    decimal? ExcelPrice, decimal MslPrice, string Kind);

public record SaleComparisonDto(
    int SaleYear, int SaleNo, int ExcelLots, int MslLots, int Joined,
    int PriceAgreements, List<SaleComparisonDiffDto> Differences);

public record TeaBoardRowDto(
    int Year, int Month, string Section, string Elevation,
    decimal? MonthQtyKg, decimal? MonthAvgRs, decimal? TodateQtyKg, decimal? TodateAvgRs);

/// <summary>
/// Master search over the imported MSL archive: every auction lot 2013–present plus the
/// yearly private-sale files and the Tea Board monthly averages. The sale-comparison
/// endpoint joins MSL rows against the weekly sale Excel catalogues (ICatalogueSource) on
/// (broker, lot no) — the verified 99.7% join — surfacing post-auction corrections.
/// </summary>
[ApiController]
[Route("api/v1/msl")]
[Authorize]
public class MslController(MongoContext db, MslImportService importer, ICatalogueSource catalogues, IMemoryCache cache) : ControllerBase
{
    /// <summary>Heavy whole-collection results (status, aggregates) are cached keyed on the
    /// importer's DataVersion — instant on repeat views, recomputed only after an import
    /// actually changes data (or the entry ages out).</summary>
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    private Task<T> Cached<T>(string key, Func<Task<T>> compute) =>
        cache.GetOrCreateAsync($"msl:{importer.DataVersion}:{key}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return compute();
        })!;

    [HttpGet("status")]
    public Task<MslStatusDto> Status() => Cached("status", ComputeStatus);

    private async Task<MslStatusDto> ComputeStatus()
    {
        var files = await db.MslFiles.Find(FilterDefinition<MslFileState>.Empty).ToListAsync();
        var total = await db.AuctionLots.EstimatedDocumentCountAsync();
        var priv = await db.AuctionLots.CountDocumentsAsync(l => l.IsPrivate);

        // Two-stage pipeline (per-sale, then per-year) rather than Distinct()-inside-group,
        // which the driver's LINQ translator doesn't support.
        var yearDocs = await db.AuctionLots.Aggregate<BsonDocument>(new[]
        {
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = new BsonDocument { ["y"] = "$y", ["s"] = "$s" },
                ["lots"] = new BsonDocument("$sum", 1),
            }),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = "$_id.y",
                ["sales"] = new BsonDocument("$sum", 1),
                ["lots"] = new BsonDocument("$sum", "$lots"),
            }),
            new BsonDocument("$sort", new BsonDocument("_id", 1)),
        }).ToListAsync();
        var years = yearDocs.Select(d => new
        {
            Year = d["_id"].ToInt32(),
            Sales = d["sales"].ToInt32(),
            Lots = d["lots"].ToInt64(),
        }).ToList();

        var tbMonths = (await db.TeaBoardAverages.Aggregate()
            .Group(t => new { t.Year, t.Month }, g => new { g.Key })
            .ToListAsync()).Count;

        return new MslStatusDto(
            importer.DataPath, total, priv, files.Count, files.Count(f => f.Error is not null),
            importer.LastScanAt, importer.LastSummary,
            years.Select(y => new MslYearStatDto(y.Year, y.Sales, y.Lots)).ToList(),
            tbMonths);
    }

    /// <summary>Manual rescan — the folder watcher already does this automatically; this
    /// is for "I just changed files and don't want to wait" and for force re-imports.</summary>
    [HttpPost("rescan")]
    public async Task<ActionResult<MslScanSummary>> Rescan([FromQuery] bool force = false, CancellationToken ct = default)
        => await importer.ScanAsync(force, ct);

    [HttpGet("search")]
    public async Task<ActionResult<MslSearchResultDto>> Search(
        [FromQuery] string? q, [FromQuery] string? broker, [FromQuery] string? grade,
        [FromQuery] string? elevation, [FromQuery] string? buyer, [FromQuery] string? factory,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, [FromQuery] int? saleNo,
        [FromQuery] bool? sold, [FromQuery] bool? isPrivate,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        pageSize = Math.Clamp(pageSize, 1, 200);
        page = Math.Max(page, 1);
        var filter = BuildFilter(q, broker, grade, elevation, buyer, factory, yearFrom, yearTo, saleNo, sold, isPrivate);

        var find = db.AuctionLots.Find(filter)
            .SortByDescending(l => l.SaleDate).ThenBy(l => l.Broker).ThenBy(l => l.LotNo);
        var items = await find.Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        var aggregate = await Cached(
            $"searchagg:{q}|{broker}|{grade}|{elevation}|{buyer}|{factory}|{yearFrom}|{yearTo}|{saleNo}|{sold}|{isPrivate}",
            () => AggregateOf(filter, ct));

        return new MslSearchResultDto(items.Select(ToDto).ToList(), aggregate.Lots, aggregate);
    }

    /// <summary>Grouped statistics over any filtered slice — the "averages, quantities or
    /// whatever" view. groupBy: year | sale | grade | elevation | mark | estate | buyer |
    /// broker | factory.</summary>
    [HttpGet("aggregate")]
    public async Task<ActionResult<List<MslAggregateRowDto>>> Aggregate(
        [FromQuery] string groupBy,
        [FromQuery] string? q, [FromQuery] string? broker, [FromQuery] string? grade,
        [FromQuery] string? elevation, [FromQuery] string? buyer, [FromQuery] string? factory,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, [FromQuery] int? saleNo,
        [FromQuery] bool? sold, [FromQuery] bool? isPrivate,
        [FromQuery] int limit = 100,
        CancellationToken ct = default)
    {
        var keyField = groupBy?.ToLowerInvariant() switch
        {
            "year" => "$y",
            "sale" => new BsonDocument("$concat", new BsonArray
                { new BsonDocument("$toString", "$y"), "-", new BsonDocument("$toString", "$s") }) as BsonValue,
            "grade" => "$g",
            "elevation" => "$el",
            "mark" => "$m",
            "estate" => "$e",
            "buyer" => new BsonDocument("$ifNull", new BsonArray { "$bn", "$bc" }) as BsonValue,
            "broker" => "$b",
            "factory" => "$f",
            _ => null,
        };
        if (keyField is null) return BadRequest("groupBy must be one of: year, sale, grade, elevation, mark, estate, buyer, broker, factory");
        limit = Math.Clamp(limit, 1, 1000);

        var filter = BuildFilter(q, broker, grade, elevation, buyer, factory, yearFrom, yearTo, saleNo, sold, isPrivate);
        var match = filter.Render(new RenderArgs<AuctionLot>(
            db.AuctionLots.DocumentSerializer, db.AuctionLots.Settings.SerializerRegistry));

        var pipeline = new[]
        {
            new BsonDocument("$match", match),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = keyField,
                ["lots"] = new BsonDocument("$sum", 1),
                ["soldLots"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 1, 0 })),
                ["totalQty"] = new BsonDocument("$sum", "$q"),
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["value"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { "$so", new BsonDocument("$multiply", new BsonArray { "$q", "$p" }), 0 })),
                ["minP"] = new BsonDocument("$min", new BsonDocument("$cond", new BsonArray
                    { "$so", "$p", BsonNull.Value })),
                ["maxP"] = new BsonDocument("$max", "$p"),
            }),
            new BsonDocument("$sort", new BsonDocument("totalQty", -1)),
            new BsonDocument("$limit", limit),
        };

        var isElevation = groupBy!.Equals("elevation", StringComparison.OrdinalIgnoreCase);
        var docs = await Cached(
            $"group:{groupBy}|{limit}|{q}|{broker}|{grade}|{elevation}|{buyer}|{factory}|{yearFrom}|{yearTo}|{saleNo}|{sold}|{isPrivate}",
            () => db.AuctionLots.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct));
        return docs.Select(d =>
        {
            var soldQty = d["soldQty"].ToDecimal();
            var value = d["value"].ToDecimal();
            var key = d["_id"].IsBsonNull ? "(unknown)" : d["_id"].ToString() ?? "(unknown)";
            if (isElevation && MslBrokers.ElevationNames.TryGetValue(key, out var elName)) key = elName;
            return new MslAggregateRowDto(
                key,
                d["lots"].ToInt64(),
                d["soldLots"].ToInt64(),
                Math.Round(d["totalQty"].ToDecimal(), 2),
                Math.Round(soldQty, 2),
                soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
                d["minP"].IsBsonNull ? null : d["minP"].ToDecimal(),
                d["maxP"].ToDecimal() is var mx and > 0 ? mx : null);
        }).ToList();
    }

    /// <summary>Joins one sale's MSL rows to the weekly sale Excel catalogue on
    /// (broker, lot) and reports every disagreement — price corrections, lots settled
    /// after the auction, and rows present on only one side.</summary>
    [HttpGet("sales/{year:int}/{saleNo:int}/comparison")]
    public async Task<ActionResult<SaleComparisonDto>> Comparison(int year, int saleNo, CancellationToken ct)
    {
        var catalogue = catalogues.ListCatalogues()
            .FirstOrDefault(c => Regex.IsMatch(c.SourceName, $@"^Sale {saleNo} - {year}$"));
        if (catalogue is null) return NotFound($"No imported sale Excel found for sale {saleNo} {year}.");
        var excelLots = catalogues.GetLots(catalogue.Id);
        if (excelLots is null) return NotFound("Catalogue lots unavailable.");

        var mslLots = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo && !l.IsPrivate)
            .ToListAsync(ct);
        var byKey = mslLots
            .Where(l => l.Broker is not null)
            .ToDictionary(l => (l.Broker!, l.LotNo), l => l);

        int joined = 0, agree = 0;
        var diffs = new List<SaleComparisonDiffDto>();
        var seen = new HashSet<(string, string)>();
        foreach (var ex in excelLots)
        {
            if (ex.Broker is null || ex.LotNumber is null) continue;
            if (!MslBrokers.ExcelCodeToMslCode.TryGetValue(ex.Broker.Trim(), out var mslBroker)) continue;
            var key = (mslBroker, ex.LotNumber.Trim().TrimStart('0'));
            if (!byKey.TryGetValue(key, out var msl))
            {
                diffs.Add(new SaleComparisonDiffDto(mslBroker, key.Item2, ex.SellingMark ?? "", ex.Grade ?? "",
                    ex.PurchasedPrice, 0, "MissingInMsl"));
                continue;
            }
            seen.Add(key);
            joined++;
            var excelPrice = ex.PurchasedPrice;
            if (excelPrice is null && msl.PriceRs == 0) { agree++; continue; }
            if (excelPrice is not null && Math.Abs(excelPrice.Value - msl.PriceRs) < 0.01m) { agree++; continue; }
            var kind = excelPrice is null ? "SoldAfterAuction"
                : msl.PriceRs == 0 ? "NotSettledInMsl"
                : "PriceCorrected";
            diffs.Add(new SaleComparisonDiffDto(mslBroker, key.Item2, msl.SellingMark, msl.Grade,
                excelPrice, msl.PriceRs, kind));
        }
        foreach (var msl in mslLots.Where(l => l.Broker is not null && !seen.Contains((l.Broker!, l.LotNo))))
            diffs.Add(new SaleComparisonDiffDto(msl.Broker!, msl.LotNo, msl.SellingMark, msl.Grade,
                null, msl.PriceRs, "MissingInExcel"));

        return new SaleComparisonDto(year, saleNo, excelLots.Count, mslLots.Count, joined, agree,
            diffs.Take(500).ToList());
    }

    [HttpGet("teaboard")]
    public async Task<ActionResult<List<TeaBoardRowDto>>> TeaBoard(
        [FromQuery] string? section, [FromQuery] string? elevation,
        [FromQuery] int? yearFrom, [FromQuery] int? yearTo, CancellationToken ct = default)
    {
        var fb = Builders<TeaBoardAverage>.Filter;
        var filters = new List<FilterDefinition<TeaBoardAverage>>();
        if (!string.IsNullOrWhiteSpace(section)) filters.Add(fb.Eq(t => t.Section, section.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(elevation)) filters.Add(fb.Eq(t => t.Elevation, elevation.ToUpperInvariant()));
        if (yearFrom is not null) filters.Add(fb.Gte(t => t.Year, yearFrom.Value));
        if (yearTo is not null) filters.Add(fb.Lte(t => t.Year, yearTo.Value));
        var rows = await db.TeaBoardAverages
            .Find(filters.Count > 0 ? fb.And(filters) : FilterDefinition<TeaBoardAverage>.Empty)
            .SortBy(t => t.Year).ThenBy(t => t.Month).ThenBy(t => t.Section).ThenBy(t => t.Elevation)
            .ToListAsync(ct);
        return rows.Select(t => new TeaBoardRowDto(
            t.Year, t.Month, t.Section, t.Elevation, t.MonthQtyKg, t.MonthAvgRs, t.TodateQtyKg, t.TodateAvgRs)).ToList();
    }

    private static FilterDefinition<AuctionLot> BuildFilter(
        string? q, string? broker, string? grade, string? elevation, string? buyer,
        string? factory, int? yearFrom, int? yearTo, int? saleNo, bool? sold, bool? isPrivate)
    {
        var fb = Builders<AuctionLot>.Filter;
        var filters = new List<FilterDefinition<AuctionLot>>();
        if (!string.IsNullOrWhiteSpace(q))
        {
            // Anchored, case-sensitive, uppercased: every name field in the MSL data is
            // uppercase, and only anchored case-sensitive regexes can walk the indexes —
            // this is what keeps a 7M-row search at milliseconds instead of a full scan.
            var re = new BsonRegularExpression("^" + Regex.Escape(q.Trim().ToUpperInvariant()));
            filters.Add(fb.Or(
                fb.Regex(l => l.SellingMark, re),
                fb.Regex(l => l.EstateName, re),
                fb.Regex(l => l.BuyerName, re),
                fb.Regex(l => l.FactoryCode, re),
                fb.Regex(l => l.MslCode, re)));
        }
        if (!string.IsNullOrWhiteSpace(broker)) filters.Add(fb.Eq(l => l.Broker, broker.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(grade)) filters.Add(fb.Eq(l => l.Grade, grade.ToUpperInvariant()));
        if (!string.IsNullOrWhiteSpace(elevation))
        {
            // Accept either the 2-digit code or the name ("WESTERN HIGH").
            var code = MslBrokers.ElevationNames.FirstOrDefault(kv =>
                kv.Value.Equals(elevation.Trim(), StringComparison.OrdinalIgnoreCase)).Key ?? elevation.Trim();
            filters.Add(fb.Eq(l => l.ElevationCode, code));
        }
        if (!string.IsNullOrWhiteSpace(buyer))
        {
            var re = new BsonRegularExpression(Regex.Escape(buyer.Trim()), "i");
            filters.Add(fb.Or(fb.Regex(l => l.BuyerCode, re), fb.Regex(l => l.BuyerName, re)));
        }
        if (!string.IsNullOrWhiteSpace(factory))
            filters.Add(fb.Eq(l => l.FactoryCode, factory.Replace(" ", "").ToUpperInvariant()));
        if (yearFrom is not null) filters.Add(fb.Gte(l => l.SaleYear, yearFrom.Value));
        if (yearTo is not null) filters.Add(fb.Lte(l => l.SaleYear, yearTo.Value));
        if (saleNo is not null) filters.Add(fb.Eq(l => l.SaleNo, saleNo.Value));
        if (sold is not null) filters.Add(fb.Eq(l => l.Sold, sold.Value));
        if (isPrivate is not null) filters.Add(fb.Eq(l => l.IsPrivate, isPrivate.Value));
        return filters.Count > 0 ? fb.And(filters) : FilterDefinition<AuctionLot>.Empty;
    }

    private async Task<MslSearchAggregateDto> AggregateOf(FilterDefinition<AuctionLot> filter, CancellationToken ct)
    {
        var match = filter.Render(new RenderArgs<AuctionLot>(
            db.AuctionLots.DocumentSerializer, db.AuctionLots.Settings.SerializerRegistry));
        var pipeline = new[]
        {
            new BsonDocument("$match", match),
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = BsonNull.Value,
                ["lots"] = new BsonDocument("$sum", 1),
                ["soldLots"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 1, 0 })),
                ["totalQty"] = new BsonDocument("$sum", "$q"),
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["value"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { "$so", new BsonDocument("$multiply", new BsonArray { "$q", "$p" }), 0 })),
                ["minP"] = new BsonDocument("$min", new BsonDocument("$cond", new BsonArray
                    { "$so", "$p", BsonNull.Value })),
                ["maxP"] = new BsonDocument("$max", "$p"),
            }),
        };
        var doc = await db.AuctionLots.Aggregate<BsonDocument>(pipeline, cancellationToken: ct).FirstOrDefaultAsync(ct);
        if (doc is null) return new MslSearchAggregateDto(0, 0, 0, 0, null, null, null);
        var soldQty = doc["soldQty"].ToDecimal();
        var value = doc["value"].ToDecimal();
        return new MslSearchAggregateDto(
            doc["lots"].ToInt64(),
            doc["soldLots"].ToInt64(),
            Math.Round(doc["totalQty"].ToDecimal(), 2),
            Math.Round(soldQty, 2),
            soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
            doc["minP"].IsBsonNull ? null : doc["minP"].ToDecimal(),
            doc["maxP"].ToDecimal() is var mx and > 0 ? mx : null);
    }

    private static AuctionLotDto ToDto(AuctionLot l) => new(
        l.SaleYear, l.SaleNo, l.SaleDate, l.Broker,
        l.Broker is not null && MslBrokers.CodeToName.TryGetValue(l.Broker, out var name) ? name : null,
        l.IsPrivate, l.LotNo, l.Invoice, l.FactoryCode, l.SellingMark, l.Grade,
        l.QuantityKg, l.PriceRs, l.Sold, l.BuyerCode, l.BuyerName, l.EstateName, l.MslCode,
        l.ElevationCode,
        l.ElevationCode is not null && MslBrokers.ElevationNames.TryGetValue(l.ElevationCode, out var el) ? el : null,
        l.RefuseTea);
}
