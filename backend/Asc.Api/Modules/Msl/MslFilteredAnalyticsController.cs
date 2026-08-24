using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>Every filter the Analysis screen offers. Empty/null members mean "no filter".
/// Category/gradeType/teaType/manufacture are translated server-side into grade sets;
/// groups (plantation companies) into factory sets — so the pipeline only ever matches
/// on indexed fields.</summary>
public record MslAnalyticsFilter(
    List<int>? Years,
    List<int>? SaleNos,
    List<int>? Months,
    List<int>? Quarters,
    List<string>? Brokers,
    List<string>? Elevations,
    List<string>? Grades,
    List<string>? Categories,
    List<string>? GradeTypes,
    List<string>? TeaTypes,
    List<string>? Manufactures,
    List<string>? Buyers,
    List<string>? Marks,
    List<string>? Factories,
    List<string>? MarkTypes,
    List<string>? Groups,
    string? SaleType,     // "public" | "private" | null
    string? SoldStatus,   // "sold" | "unsold" | null
    string? RefuseTea,    // "only" | "exclude" | null
    decimal? PriceMin,
    decimal? PriceMax,
    string? MarkSearch,
    string? BuyerSearch,
    List<string>? LotNos,
    List<string>? Invoices,
    List<int>? Bags,
    List<decimal>? Packings,
    List<string>? Districts,
    string? SharingStatus, // "asc" (marks ASC also sells) | "other" | null
    string? Organic);      // "organic" | "non" | null — name-based heuristic

public record FilteredSectionRow(
    string Key, string? Label, long Lots, long SoldLots, decimal TotalQtyKg, decimal SoldQtyKg,
    decimal ProceedsRs, decimal? AvgPriceRs, decimal? MaxPriceRs, decimal? AskingAvgRs = null);

public record OptionRow(string Key, string? Label, long Lots);

public record FilteredLotsRequest(MslAnalyticsFilter? Filter, int? Page, int? PageSize, string? Search);

public record FilteredLotRowDto(
    int SaleYear, int SaleNo, DateTime SaleDate, string? Broker, bool IsPrivate,
    string LotNo, string? Invoice, string FactoryCode, string SellingMark, string Grade,
    string Category, decimal QuantityKg, decimal PriceRs, bool Sold, string? Buyer,
    int? Bags, decimal? PackingKg, decimal? AskingRs);

public record FilteredLotsDto(List<FilteredLotRowDto> Rows, int Page, bool HasMore);

/// <summary>The values each filter can still take INSIDE the current slice — this is what
/// makes the panel cascade: pick 2026 and every dropdown shrinks to what 2026 contains.</summary>
public record AvailableOptionsDto(
    List<OptionRow> Grades,
    List<OptionRow> Buyers,
    List<OptionRow> Marks,
    List<OptionRow> Factories,
    List<OptionRow> Groups,
    List<OptionRow> LotNos,
    List<OptionRow> Invoices,
    List<OptionRow> Bags,
    List<OptionRow> Packings,
    List<OptionRow> Districts,
    List<OptionRow> SaleNos,
    List<OptionRow> Years,
    List<OptionRow> Months,
    List<OptionRow> Brokers,
    List<OptionRow> Elevations,
    List<OptionRow> SaleTypes,
    List<OptionRow> SoldStatuses,
    List<OptionRow> RefuseTea);

public record FilteredAnalyticsDto(
    FilteredSectionRow Total,
    List<FilteredSectionRow> ByBroker,
    List<FilteredSectionRow> ByElevation,
    List<FilteredSectionRow> ByGrade,
    List<FilteredSectionRow> ByCategory,
    List<FilteredSectionRow> ByBuyer,
    List<FilteredSectionRow> ByMark,
    List<FilteredSectionRow> ByFactory,
    List<FilteredSectionRow> ByPriceRange,
    /// <summary>Per-bag packing (kg) — "(none)" for rows without the Excel join.</summary>
    List<FilteredSectionRow> ByPacking,
    List<FilteredSectionRow> BySale,
    /// <summary>Sold / Outsold / Unsold decomposition — OKLO status where the Excel join
    /// exists; MSL sold/unsold fills the gaps (private rows, pre-Excel years).</summary>
    List<FilteredSectionRow> ByOkloStatus,
    AvailableOptionsDto Available,
    long ElapsedMs);

public record FilterOptionsDto(
    List<int> Years,
    List<SaleSummaryDto> Sales,
    List<string> Brokers,
    List<FilteredSectionRow> Elevations,
    List<string> Grades,
    Dictionary<string, string> GradeCategories,
    Dictionary<string, string[]> GradeClasses, // grade → [category, gradeType, teaType, manufacture]
    List<string> Categories,
    List<string> GradeTypes,
    List<string> TeaTypes,
    List<string> Manufactures,
    List<string> MarkTypes,
    List<string> Groups,
    List<string> Buyers,
    Dictionary<string, string> BuyerNames);

/// <summary>
/// The cross-filtering engine behind the Analysis screen: one aggregation pass computes
/// every section ($facet), so applying any filter re-renders the whole page from a single
/// round trip. Results are cached on (filter signature, DataVersion) — repeated filter
/// combinations are instant, and new MSL imports invalidate automatically.
/// </summary>
[ApiController]
[Route("api/v1/msl/analytics")]
[Authorize]
public class MslFilteredAnalyticsController(
    MongoContext db, MslImportService importer, MslReferenceService reference, IMemoryCache cache) : ControllerBase
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    [HttpPost("filtered")]
    public async Task<ActionResult<FilteredAnalyticsDto>> Filtered([FromBody] MslAnalyticsFilter filter, CancellationToken ct)
    {
        var key = "msl:filtered:" + importer.DataVersion + ":" +
                  Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(filter))));
        var result = await cache.GetOrCreateAsync(key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            return await ComputeAsync(filter, ct);
        });
        return result!;
    }

    /// <summary>Selling marks ASC (broker AS) sold in the given years — the "sharing
    /// status" reference set.</summary>
    private Task<List<string>> AscMarksAsync(List<int>? years, CancellationToken ct) =>
        cache.GetOrCreateAsync(
            $"msl:ascmarks:{importer.DataVersion}:{string.Join(',', years ?? [])}",
            async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = CacheTtl;
                var fb = Builders<AuctionLot>.Filter;
                var filter = fb.Eq(l => l.Broker, "AS");
                if (years is { Count: > 0 }) filter &= fb.In(l => l.SaleYear, years);
                return await db.AuctionLots.Distinct(l => l.SellingMark, filter).ToListAsync(ct);
            })!;

    /// <summary>Buyer code → most recent display name, learned from the rollups (buyer
    /// names in the MSL files are truncated and vary by broker; the newest spelling wins).</summary>
    private Task<Dictionary<string, string>> BuyerNamesAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("msl:buyernames:" + importer.DataVersion, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            var rows = await db.MslSaleStats
                .Find(s => s.Dimension == "buyer" && s.Label != null)
                .SortBy(s => s.Year).ThenBy(s => s.SaleNo)
                .Project(s => new { s.Key, s.Label })
                .ToListAsync(ct);
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in rows) map[r.Key] = r.Label!; // later sales overwrite older spellings
            return map;
        })!;

    [HttpGet("filter-options")]
    public async Task<ActionResult<FilterOptionsDto>> FilterOptions(CancellationToken ct)
    {
        var key = "msl:filteropts:" + importer.DataVersion;
        var result = await cache.GetOrCreateAsync(key, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;

            var totals = await db.MslSaleStats.Find(s => s.Dimension == "total")
                .SortByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).ToListAsync(ct);
            var grades = await db.MslSaleStats.Distinct(s => s.Key, s => s.Dimension == "grade").ToListAsync(ct);
            var buyers = await db.MslSaleStats.Distinct(s => s.Key, s => s.Dimension == "buyer").ToListAsync(ct);
            var elevations = await db.MslSaleStats
                .Find(s => s.Dimension == "elevation" && s.Year == totals.FirstOrDefault()!.Year)
                .ToListAsync(ct);

            // Real sale-book categories (Ex-estate, etc.) and the private-sale bucket are
            // lot-level overrides, not a function of grade alone — pure grade-classification
            // categories miss them entirely, which meant they never appeared as pickable
            // options despite already appearing correctly in the Category Mix breakdown.
            var saleCategories = await db.AuctionLots.Distinct(
                l => l.SaleCategory, Builders<AuctionLot>.Filter.Ne(l => l.SaleCategory, null)).ToListAsync(ct);

            var gradeCats = grades.ToDictionary(g => g, g => MslClassification.Classify(g).Category);
            var gradeClasses = grades.ToDictionary(g => g, g =>
            {
                var c = MslClassification.Classify(g);
                return new[] { c.Category, c.GradeType, c.TeaType, c.Manufacture };
            });
            var buyerNames = await BuyerNamesAsync(ct);
            return new FilterOptionsDto(
                [.. totals.Select(t => t.Year).Distinct().OrderDescending()],
                totals.Select(t => new SaleSummaryDto(
                    t.Year, t.SaleNo, t.SaleDate, t.Lots, t.SoldLots,
                    Math.Round(t.TotalQtyKg, 2), Math.Round(t.SoldQtyKg, 2), Math.Round(t.ProceedsRs, 2),
                    t.SoldQtyKg > 0 ? Math.Round(t.ProceedsRs / t.SoldQtyKg, 2) : null)).ToList(),
                [.. MslBrokers.CodeToName.Keys.OrderBy(k => k)],
                elevations.GroupBy(e => e.Key).Select(g => g.First()).Select(e => new FilteredSectionRow(
                    e.Key, e.Label, 0, 0, 0, 0, 0, null, null)).ToList(),
                [.. grades.Order()],
                gradeCats,
                gradeClasses,
                [.. gradeCats.Values
                    .Concat(saleCategories.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => MslClassification.NormalizeSaleCategory(c!)))
                    .Append(MslClassification.PrivateSaleCategory)
                    .Distinct()
                    .Order()],
                ["Main Grade", "Off Grade"],
                ["Black Tea", "Green Tea"],
                ["Orthodox", "CTC"],
                ["MF", "BF", "RT", "HT"],
                [.. reference.GroupToFactories().Keys.Order()],
                [.. buyers.Order()],
                buyerNames);
        });
        return result!;
    }

    /// <summary>Lot-line detail under the FULL filter object — the reports' "Invoice Line
    /// Details" source. Same filter semantics as /filtered, paged.</summary>
    [HttpPost("filtered/lots")]
    public async Task<ActionResult<FilteredLotsDto>> FilteredLots([FromBody] FilteredLotsRequest req, CancellationToken ct)
    {
        var pageSize = Math.Clamp(req.PageSize ?? 200, 1, 500);
        var page = Math.Max(req.Page ?? 1, 1);
        if (req.Filter is null) return BadRequest("A filter object is required.");
        var stages = await MatchStagesAsync(req.Filter, ct);
        // In-report quick search: prefix match over mark/estate/buyer/grade/invoice/lot.
        if (!string.IsNullOrWhiteSpace(req.Search))
        {
            var term = System.Text.RegularExpressions.Regex.Escape(req.Search.Trim().ToUpperInvariant());
            var re = new BsonRegularExpression("^" + term);
            stages.Add(new BsonDocument("$match", new BsonDocument("$or", new BsonArray
            {
                new BsonDocument("m", re), new BsonDocument("e", re), new BsonDocument("bn", re),
                new BsonDocument("g", re), new BsonDocument("i", re), new BsonDocument("l", req.Search.Trim().TrimStart('0')),
            })));
        }
        // Numeric lot order (string sort would give 1, 10, 100, 1000, …).
        stages.Add(new BsonDocument("$addFields", new BsonDocument("ln",
            new BsonDocument("$convert", new BsonDocument { ["input"] = "$l", ["to"] = "int", ["onError"] = 999999999 }))));
        stages.Add(new BsonDocument("$sort", new BsonDocument { ["y"] = -1, ["s"] = -1, ["b"] = 1, ["ln"] = 1 }));
        stages.Add(new BsonDocument("$skip", (page - 1) * pageSize));
        stages.Add(new BsonDocument("$limit", pageSize));
        // Drop the synthetic sort key — AuctionLot has no member for it and the driver
        // treats unknown elements as a deserialization error.
        stages.Add(new BsonDocument("$unset", "ln"));
        var docs = await db.AuctionLots.Aggregate<AuctionLot>(
            stages, new AggregateOptions { AllowDiskUse = true }, ct).ToListAsync(ct);
        var rows = docs.Select(l => new FilteredLotRowDto(
            l.SaleYear, l.SaleNo, l.SaleDate, l.Broker, l.IsPrivate, l.LotNo, l.Invoice,
            l.FactoryCode, l.SellingMark, l.Grade,
            // Private lots get their own category regardless of grade; otherwise the Excel
            // join (2026+) beats a grade-name guess. See MslClassification.ResolveCategory.
            MslClassification.ResolveCategory(l.IsPrivate, l.SaleCategory, l.Grade),
            l.QuantityKg, l.PriceRs, l.Sold, l.BuyerName ?? l.BuyerCode, l.Bags, l.PackingKg, l.AskingRs)).ToList();
        return new FilteredLotsDto(rows, page, rows.Count == pageSize);
    }

    /// <summary>Builds the aggregation prologue (indexed $match + optional month/quarter
    /// $expr match) for a filter — shared by the analytics facets and the lot-line report.</summary>
    private async Task<List<BsonDocument>> MatchStagesAsync(MslAnalyticsFilter f, CancellationToken ct)
    {
        var fb = Builders<AuctionLot>.Filter;
        var filters = new List<FilterDefinition<AuctionLot>>();

        void In<T>(List<T>? values, System.Linq.Expressions.Expression<Func<AuctionLot, T>> field)
        {
            if (values is { Count: > 0 }) filters.Add(fb.In(field, values));
        }

        In(f.Years, l => l.SaleYear);
        In(f.SaleNos, l => l.SaleNo);
        // Months/quarters are applied as an $expr stage after the indexed match — see below.
        In(f.Brokers?.Select(b => (string?)b.ToUpperInvariant()).ToList(), l => l.Broker);
        In(f.Elevations?.Select(e => (string?)ElevationCodeOf(e)).ToList(), l => l.ElevationCode);
        In(f.Buyers?.Select(b => (string?)b).ToList(), l => l.BuyerCode);
        In(f.Marks, l => l.SellingMark);

        // Grade type/tea type/manufacture filters resolve to a concrete grade set (indexed
        // $in) — independent of Category now (see below), since they're each their own
        // function of grade alone and compose by intersection exactly as before.
        var gradeSet = f.Grades?.Select(g => g.ToUpperInvariant()).ToHashSet();
        List<string>? known = null;
        async Task<List<string>> KnownGradesAsync() =>
            known ??= await db.MslSaleStats.Distinct(s => s.Key, s => s.Dimension == "grade").ToListAsync(ct);
        if (f.GradeTypes is { Count: > 0 } || f.TeaTypes is { Count: > 0 } || f.Manufactures is { Count: > 0 })
        {
            var matching = MslClassification.GradesMatching(await KnownGradesAsync(), null, f.GradeTypes, f.TeaTypes, f.Manufactures);
            gradeSet = gradeSet is null ? matching : [.. gradeSet.Intersect(matching, StringComparer.OrdinalIgnoreCase)];
        }
        if (gradeSet is not null) filters.Add(fb.In(l => l.Grade, gradeSet));

        // Category resolves the same way ResolveCategory does per lot: private lots match
        // "Private Sale" outright; otherwise the real SaleCategory (Excel-enriched, 2026+)
        // wins when present, falling back to grade-name classification only when it isn't
        // — so a filter click behaves exactly like the Category Mix breakdown it's filtering
        // (confirmed 24 Aug 2026: before this, "Ex-estate"/"Private Sale" weren't even
        // reachable as filter values — GradesMatching had no grade that maps to either, so
        // selecting them silently matched zero rows).
        if (f.Categories is { Count: > 0 })
        {
            var wantsPrivate = f.Categories.Contains(MslClassification.PrivateSaleCategory, StringComparer.OrdinalIgnoreCase);
            var otherCats = f.Categories.Where(c => !string.Equals(c, MslClassification.PrivateSaleCategory, StringComparison.OrdinalIgnoreCase)).ToList();
            var categoryOr = new List<FilterDefinition<AuctionLot>>();
            if (wantsPrivate) categoryOr.Add(fb.Eq(l => l.IsPrivate, true));
            if (otherCats.Count > 0)
            {
                var rawSaleCategoryValues = otherCats
                    .SelectMany(c => string.Equals(c, "High & Medium", StringComparison.OrdinalIgnoreCase)
                        ? (string[])["High & Medium", "High and Medium"] : [c])
                    .ToList();
                var fallbackGrades = MslClassification.GradesMatching(await KnownGradesAsync(), otherCats, null, null, null);
                categoryOr.Add(fb.And(
                    fb.Eq(l => l.IsPrivate, false),
                    fb.Or(
                        fb.In(l => l.SaleCategory, rawSaleCategoryValues),
                        fb.And(fb.Eq(l => l.SaleCategory, (string?)null), fb.In(l => l.Grade, fallbackGrades)))));
            }
            if (categoryOr.Count > 0) filters.Add(fb.Or(categoryOr));
        }

        // Groups (plantation companies) resolve to factory sets; mark types to code prefixes.
        var factorySet = f.Factories?.Select(x => x.Replace(" ", "").ToUpperInvariant()).ToHashSet();
        if (f.Groups is { Count: > 0 })
        {
            // Expand each group's Excel factory codes into every MSL variant of the same
            // family, so MFA0602 lots still match a group known by MF0602.
            var families = await FactoryFamiliesAsync(ct);
            var groupFactories = reference.GroupToFactories();
            var fromGroups = f.Groups
                .SelectMany(g => groupFactories.GetValueOrDefault(g, []))
                .SelectMany(code => families.GetValueOrDefault(NormalizeFactory(code), [code]).Append(code))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            factorySet = factorySet is null ? fromGroups : [.. factorySet.Intersect(fromGroups, StringComparer.OrdinalIgnoreCase)];
        }
        if (factorySet is not null) filters.Add(fb.In(l => l.FactoryCode, factorySet));
        if (f.MarkTypes is { Count: > 0 })
            filters.Add(fb.Or(f.MarkTypes.Select(p =>
                fb.Regex(l => l.FactoryCode, new BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(p.ToUpperInvariant()))))));

        if (f.SaleType == "public") filters.Add(fb.Eq(l => l.IsPrivate, false));
        if (f.SaleType == "private") filters.Add(fb.Eq(l => l.IsPrivate, true));
        if (f.SoldStatus == "sold") filters.Add(fb.Eq(l => l.Sold, true));
        if (f.SoldStatus == "unsold") filters.Add(fb.Eq(l => l.Sold, false));
        if (f.RefuseTea == "only") filters.Add(fb.Eq(l => l.RefuseTea, true));
        if (f.RefuseTea == "exclude") filters.Add(fb.Eq(l => l.RefuseTea, false));
        if (f.PriceMin is not null) filters.Add(fb.Gte(l => l.PriceRs, f.PriceMin.Value));
        if (f.PriceMax is not null) filters.Add(fb.Lte(l => l.PriceRs, f.PriceMax.Value));
        if (!string.IsNullOrWhiteSpace(f.MarkSearch))
        {
            var re = new BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(f.MarkSearch.Trim().ToUpperInvariant()));
            filters.Add(fb.Or(fb.Regex(l => l.SellingMark, re), fb.Regex(l => l.EstateName, re)));
        }
        if (!string.IsNullOrWhiteSpace(f.BuyerSearch))
        {
            var re = new BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(f.BuyerSearch.Trim().ToUpperInvariant()));
            filters.Add(fb.Or(fb.Regex(l => l.BuyerName, re), fb.Regex(l => l.BuyerCode, re)));
        }
        In(f.LotNos?.Select(x => x.Trim().TrimStart('0')).ToList(), l => l.LotNo);
        if (f.Invoices is { Count: > 0 }) filters.Add(fb.In(l => l.Invoice, f.Invoices));
        if (f.Bags is { Count: > 0 }) filters.Add(fb.In("bg", f.Bags));
        if (f.Packings is { Count: > 0 }) filters.Add(fb.In("pk", f.Packings));
        In(f.Districts?.Select(x => (string?)x).ToList(), l => l.DistrictCode);
        if (f.Organic == "organic")
            filters.Add(fb.Or(
                fb.Regex(l => l.SellingMark, new BsonRegularExpression("ORGANIC|BIO ")),
                fb.Regex(l => l.EstateName, new BsonRegularExpression("ORGANIC|BIO "))));
        if (f.Organic == "non")
            filters.Add(fb.And(
                fb.Not(fb.Regex(l => l.SellingMark, new BsonRegularExpression("ORGANIC|BIO "))),
                fb.Not(fb.Regex(l => l.EstateName, new BsonRegularExpression("ORGANIC|BIO ")))));
        if (f.SharingStatus is "asc" or "other")
        {
            // "ASC sharing mark" = a selling mark ASC itself also sells within the selected
            // years — computed once per (years, data version) and cached.
            var ascMarks = await AscMarksAsync(f.Years, ct);
            filters.Add(f.SharingStatus == "asc"
                ? fb.In(l => l.SellingMark, ascMarks)
                : fb.Nin(l => l.SellingMark, ascMarks));
        }

        var matchFilter = filters.Count > 0 ? fb.And(filters) : FilterDefinition<AuctionLot>.Empty;
        var match = matchFilter.Render(new RenderArgs<AuctionLot>(
            db.AuctionLots.DocumentSerializer, db.AuctionLots.Settings.SerializerRegistry));

        // Month/quarter can't hit an index anyway — apply as a $expr after the indexed match.
        var monthConds = new BsonArray();
        if (f.Months is { Count: > 0 })
            monthConds.Add(new BsonDocument("$in", new BsonArray { new BsonDocument("$month", "$d"), new BsonArray(f.Months) }));
        if (f.Quarters is { Count: > 0 })
            monthConds.Add(new BsonDocument("$in", new BsonArray
            {
                new BsonDocument("$ceil", new BsonDocument("$divide", new BsonArray { new BsonDocument("$month", "$d"), 3 })),
                new BsonArray(f.Quarters),
            }));

        var stages = new List<BsonDocument> { new("$match", match) };
        if (monthConds.Count > 0)
            stages.Add(new BsonDocument("$match", new BsonDocument("$expr", new BsonDocument("$and", monthConds))));
        return stages;
    }

    private async Task<FilteredAnalyticsDto> ComputeAsync(MslAnalyticsFilter f, CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        var stages = await MatchStagesAsync(f, ct);
        // Slim each document to the facet fields before fan-out — the $facet stage copies
        // its input once per facet, so dropping the wide name/text fields pays 9× over.
        stages.Add(new BsonDocument("$project", new BsonDocument
        {
            ["b"] = 1, ["el"] = 1, ["g"] = 1, ["bc"] = 1, ["m"] = 1, ["f"] = 1,
            ["q"] = 1, ["p"] = 1, ["so"] = 1, ["y"] = 1, ["s"] = 1,
            ["l"] = 1, ["i"] = 1, ["bg"] = 1, ["pk"] = 1, ["dc"] = 1,
            ["d"] = 1, ["pv"] = 1, ["rf"] = 1, ["st"] = 1, ["ak"] = 1, ["ct"] = 1,
        }));

        BsonArray OptionsAsc(BsonValue id, int limit) =>
        [
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = id,
                ["lots"] = new BsonDocument("$sum", 1),
            }),
            new BsonDocument("$sort", new BsonDocument("_id", 1)),
            new BsonDocument("$limit", limit),
        ];

        BsonArray Options(BsonValue id, int limit) =>
        [
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = id,
                ["lots"] = new BsonDocument("$sum", 1),
                ["qty"] = new BsonDocument("$sum", "$q"),
            }),
            new BsonDocument("$sort", new BsonDocument("qty", -1)),
            new BsonDocument("$limit", limit),
        ];

        BsonArray Facet(BsonValue id, int limit, BsonDocument? sort = null) =>
        [
            new BsonDocument("$group", new BsonDocument
            {
                ["_id"] = id,
                ["lots"] = new BsonDocument("$sum", 1),
                ["soldLots"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 1, 0 })),
                ["totalQty"] = new BsonDocument("$sum", "$q"),
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["value"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { "$so", new BsonDocument("$multiply", new BsonArray { "$q", "$p" }), 0 })),
                ["maxP"] = new BsonDocument("$max", "$p"),
                ["askVal"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    {
                        new BsonDocument("$gt", new BsonArray { "$ak", 0 }),
                        new BsonDocument("$multiply", new BsonArray { "$q", "$ak" }),
                        0,
                    })),
                ["askQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray
                    { new BsonDocument("$gt", new BsonArray { "$ak", 0 }), "$q", 0 })),
            }),
            sort ?? new BsonDocument("$sort", new BsonDocument("totalQty", -1)),
            new BsonDocument("$limit", limit),
        ];

        var priceBucketId = new BsonDocument("$switch", new BsonDocument
        {
            ["branches"] = new BsonArray
            {
                new BsonDocument { ["case"] = new BsonDocument("$eq", new BsonArray { "$so", false }), ["then"] = "Unsold" },
                Branch(0.01, 400, "< 400"), Branch(400, 600, "400–600"), Branch(600, 800, "600–800"),
                Branch(800, 1000, "800–1,000"), Branch(1000, 1200, "1,000–1,200"), Branch(1200, 1500, "1,200–1,500"),
                Branch(1500, 2000, "1,500–2,000"), Branch(2000, 3000, "2,000–3,000"),
            },
            ["default"] = "3,000+",
        });

        stages.Add(new BsonDocument("$facet", new BsonDocument
        {
            ["total"] = Facet(BsonNull.Value, 1),
            ["byBroker"] = Facet("$b", 12),
            ["byElevation"] = Facet("$el", 8),
            ["byGrade"] = Facet("$g", 800),
            ["byBuyer"] = Facet(new BsonDocument("$ifNull", new BsonArray { "$bc", "(none)" }), 60),
            ["byMark"] = Facet("$m", 120),
            ["byFactory"] = Facet("$f", 120),
            ["byPriceRange"] = Facet(priceBucketId, 12),
            ["byPacking"] = Facet(new BsonDocument("$ifNull", new BsonArray { "$pk", BsonNull.Value }), 80),
            ["bySale"] = Facet(new BsonDocument { ["y"] = "$y", ["s"] = "$s" }, 400,
                new BsonDocument("$sort", new BsonDocument("_id", 1))),
            // Option facets: keys + counts only, wider limits — these drive the cascading
            // filter dropdowns (what values remain available inside this slice).
            ["optGrades"] = Options("$g", 800),
            ["optBuyers"] = Options("$bc", 800),
            ["optMarks"] = Options("$m", 1500),
            ["optFactories"] = Options("$f", 1500),
            ["optLots"] = OptionsAsc("$l", 3000),
            ["optInvoices"] = OptionsAsc("$i", 3000),
            ["optBags"] = OptionsAsc("$bg", 60),
            ["optPackings"] = OptionsAsc("$pk", 60),
            ["optDistricts"] = Options("$dc", 120),
            ["optMonths"] = OptionsAsc(new BsonDocument("$month", "$d"), 12),
            ["optSaleTypes"] = OptionsAsc("$pv", 2),
            ["optSold"] = OptionsAsc("$so", 2),
            ["optRefuse"] = OptionsAsc("$rf", 2),
            ["byOklo"] = Facet(new BsonDocument { ["st"] = new BsonDocument("$ifNull", new BsonArray { "$st", "" }), ["so"] = "$so" }, 12),
            // Raw material for byCategory below: grouped by (IsPrivate, Excel-enriched
            // SaleCategory, Grade) rather than Grade alone, so the real category — private
            // lots' own bucket, "Ex-estate" and other sale-book categories the grade-name
            // heuristic can't see — wins over the guess. Small cardinality, so a generous
            // limit costs nothing.
            ["byCategoryRaw"] = Facet(new BsonDocument
                {
                    ["pv"] = "$pv",
                    ["sc"] = new BsonDocument("$ifNull", new BsonArray { "$ct", BsonNull.Value }),
                    ["g"] = "$g",
                }, 3000),
        }));

        var doc = await db.AuctionLots.Aggregate<BsonDocument>(stages, new AggregateOptions { AllowDiskUse = true }, ct)
            .FirstAsync(ct);

        List<FilteredSectionRow> Rows(string facet, Func<BsonValue, (string Key, string? Label)>? keyFn = null) =>
            doc[facet].AsBsonArray.Select(v =>
            {
                var d = v.AsBsonDocument;
                var (key, label) = keyFn?.Invoke(d["_id"]) ?? (d["_id"].IsBsonNull ? "(none)" : d["_id"].ToString() ?? "(none)", null);
                var soldQty = d["soldQty"].ToDecimal();
                var value = d["value"].ToDecimal();
                var askQty = d.Contains("askQty") ? d["askQty"].ToDecimal() : 0;
                var askVal = d.Contains("askVal") ? d["askVal"].ToDecimal() : 0;
                return new FilteredSectionRow(
                    key, label,
                    d["lots"].ToInt64(), d["soldLots"].ToInt64(),
                    Math.Round(d["totalQty"].ToDecimal(), 2), Math.Round(soldQty, 2), Math.Round(value, 2),
                    soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
                    d["maxP"].ToDecimal() is var mx and > 0 ? mx : null,
                    askQty > 0 ? Math.Round(askVal / askQty, 2) : null);
            }).ToList();

        var buyerNames = await BuyerNamesAsync(ct);
        var factoryRefs = reference.ByFactory;

        var byGrade = Rows("byGrade");
        // Category rollup: prefer the Excel-enriched SaleCategory per (category, grade)
        // group, falling back to grade-name classification only where the Excel join
        // doesn't cover it (pre-2026 sales) — same precedence FilteredLotRowDto already
        // uses per-lot. Grouping the RAW per-lot category here, rather than re-deriving
        // from byGrade's grade-only buckets, is what actually recovers "Ex-estate" and the
        // sale-book's other categories that no grade-name heuristic alone can catch
        // (confirmed against the portal's Invoice Line Details 22 Aug 2026).
        var byCategory = doc["byCategoryRaw"].AsBsonArray
            .Select(v =>
            {
                var d = v.AsBsonDocument;
                var idDoc = d["_id"].AsBsonDocument;
                var isPrivate = idDoc.Contains("pv") && !idDoc["pv"].IsBsonNull && idDoc["pv"].AsBoolean;
                var sc = idDoc["sc"].IsBsonNull ? null : idDoc["sc"].AsString;
                var g = idDoc["g"].IsBsonNull ? "" : idDoc["g"].AsString;
                var category = MslClassification.ResolveCategory(isPrivate, sc, g);
                return (Category: category, Lots: d["lots"].ToInt64(), SoldLots: d["soldLots"].ToInt64(),
                    TotalQty: d["totalQty"].ToDecimal(), SoldQty: d["soldQty"].ToDecimal(),
                    Value: d["value"].ToDecimal(), MaxP: d["maxP"].ToDecimal());
            })
            .GroupBy(x => x.Category)
            .Select(g =>
            {
                var soldQty = g.Sum(x => x.SoldQty);
                var value = g.Sum(x => x.Value);
                return new FilteredSectionRow(
                    g.Key, null,
                    g.Sum(x => x.Lots), g.Sum(x => x.SoldLots),
                    Math.Round(g.Sum(x => x.TotalQty), 2), Math.Round(soldQty, 2), Math.Round(value, 2),
                    soldQty > 0 ? Math.Round(value / soldQty, 2) : null,
                    g.Max(x => x.MaxP) is var mx and > 0 ? mx : null);
            })
            .OrderByDescending(r => r.TotalQtyKg)
            .ToList();

        var totalRows = Rows("total");
        var total = totalRows.FirstOrDefault() ?? new FilteredSectionRow("all", null, 0, 0, 0, 0, 0, null, null);

        return new FilteredAnalyticsDto(
            total with { Key = "all" },
            Rows("byBroker", id => (id.IsBsonNull ? "PVT" : id.AsString, id.IsBsonNull ? "Private sales" : MslBrokers.CodeToName.GetValueOrDefault(id.AsString))),
            Rows("byElevation", id => (id.IsBsonNull ? "(none)" : id.AsString, id.IsBsonNull ? null : MslBrokers.ElevationNames.GetValueOrDefault(id.AsString))),
            byGrade,
            byCategory,
            Rows("byBuyer", id => (id.IsBsonNull ? "(none)" : id.AsString,
                id.IsBsonNull ? null : buyerNames.GetValueOrDefault(id.AsString))),
            Rows("byMark"),
            Rows("byFactory", id =>
            {
                if (id.IsBsonNull) return ("(none)", null);
                var code = id.AsString;
                var label = factoryRefs.TryGetValue(code, out var fr) ? fr.FactoryName
                    : factoryRefs.TryGetValue(NormalizeFactory(code), out var nf2) ? nf2.FactoryName : null;
                return (code, label);
            }),
            Rows("byPriceRange"),
            Rows("byPacking", id => (id.IsBsonNull ? "(none)" : id.ToString() ?? "(none)", null)),
            Rows("bySale", id => ($"{id["s"].ToInt32():00}/{id["y"].ToInt32()}", null)),
            BuildOklo(),
            BuildOptions(),
            (long)(DateTime.UtcNow - started).TotalMilliseconds);

        List<FilteredSectionRow> BuildOklo()
        {
            // Fold the (status, msl-sold) pairs into the portal's three buckets.
            var buckets = new Dictionary<string, (long Lots, long SoldLots, decimal Qty, decimal SoldQty, decimal Value, decimal? Max)>();
            void Fold(string key, BsonDocument d)
            {
                var soldQty = d["soldQty"].ToDecimal();
                var cur = buckets.GetValueOrDefault(key);
                var max = d["maxP"].ToDecimal();
                buckets[key] = (cur.Lots + d["lots"].ToInt64(), cur.SoldLots + d["soldLots"].ToInt64(),
                    cur.Qty + d["totalQty"].ToDecimal(), cur.SoldQty + soldQty,
                    cur.Value + d["value"].ToDecimal(),
                    max > 0 ? Math.Max(cur.Max ?? 0, max) : cur.Max);
            }
            foreach (var v in doc["byOklo"].AsBsonArray)
            {
                var d = v.AsBsonDocument;
                var st = d["_id"]["st"].AsString;
                var mslSold = d["_id"]["so"].AsBoolean;
                var key = st switch
                {
                    "Outsold" => "Outsold",
                    "Sold" => "Sold",
                    "Unsold" or "Pending" => "Unsold",
                    _ => mslSold ? "Sold" : "Unsold", // no Excel status (private / pre-2026)
                };
                Fold(key, d);
            }
            return buckets.Select(kv => new FilteredSectionRow(
                kv.Key, null, kv.Value.Lots, kv.Value.SoldLots,
                Math.Round(kv.Value.Qty, 2), Math.Round(kv.Value.SoldQty, 2), Math.Round(kv.Value.Value, 2),
                kv.Value.SoldQty > 0 ? Math.Round(kv.Value.Value / kv.Value.SoldQty, 2) : null,
                kv.Value.Max)).OrderByDescending(r => r.TotalQtyKg).ToList();
        }

        AvailableOptionsDto BuildOptions()
        {
            List<OptionRow> Opt(string facet, Func<string, string?>? labelOf = null) =>
                doc[facet].AsBsonArray
                    .Where(v => !v.AsBsonDocument["_id"].IsBsonNull)
                    .Select(v =>
                    {
                        var d = v.AsBsonDocument;
                        var idv = d["_id"];
                        // Non-string keys (bags int, packing decimal) stringify for the UI.
                        var k = idv.IsString ? idv.AsString : idv.ToString() ?? "";
                        return new OptionRow(k, labelOf?.Invoke(k), d["lots"].ToInt64());
                    })
                    .Where(o => o.Key.Length > 0)
                    .ToList();

            var factories = Opt("optFactories", code =>
                factoryRefs.TryGetValue(code, out var fr) ? fr.FactoryName
                : factoryRefs.TryGetValue(NormalizeFactory(code), out var nf3) ? nf3.FactoryName : null);

            // Groups available in this slice = groups whose factories intersect the slice.
            var sliceFactories = factories.Select(x => NormalizeFactory(x.Key)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var groups = reference.GroupToFactories()
                .Where(kv => kv.Value.Any(code => sliceFactories.Contains(NormalizeFactory(code))))
                .Select(kv => new OptionRow(kv.Key, null, kv.Value.Count))
                .OrderBy(o => o.Key)
                .ToList();

            // Boolean facets ($pv/$so/$rf) map to the filter values the UI sends.
            List<OptionRow> BoolOpt(string facet, string trueKey, string trueLabel, string falseKey, string falseLabel) =>
                doc[facet].AsBsonArray
                    .Where(v => !v.AsBsonDocument["_id"].IsBsonNull)
                    .Select(v =>
                    {
                        var d = v.AsBsonDocument;
                        var isTrue = d["_id"].AsBoolean;
                        return new OptionRow(isTrue ? trueKey : falseKey, isTrue ? trueLabel : falseLabel, d["lots"].ToInt64());
                    })
                    .ToList();

            var bySaleRows = doc["bySale"].AsBsonArray.Select(v => v.AsBsonDocument).ToList();
            return new AvailableOptionsDto(
                Opt("optGrades"),
                Opt("optBuyers", code => buyerNames.GetValueOrDefault(code)),
                Opt("optMarks"),
                factories,
                groups,
                Opt("optLots"),
                Opt("optInvoices"),
                Opt("optBags"),
                Opt("optPackings"),
                Opt("optDistricts"),
                bySaleRows.Select(d => new OptionRow(
                    d["_id"]["s"].ToInt32().ToString(), null, d["lots"].ToInt64())).ToList(),
                bySaleRows.GroupBy(d => d["_id"]["y"].ToInt32())
                    .Select(g => new OptionRow(g.Key.ToString(), null, g.Sum(x => x["lots"].ToInt64()))).ToList(),
                Opt("optMonths"),
                doc["byBroker"].AsBsonArray.Select(v => v.AsBsonDocument).Select(d => new OptionRow(
                    d["_id"].IsBsonNull ? "PVT" : d["_id"].AsString,
                    d["_id"].IsBsonNull ? "Private sales" : MslBrokers.CodeToName.GetValueOrDefault(d["_id"].AsString),
                    d["lots"].ToInt64())).ToList(),
                doc["byElevation"].AsBsonArray.Select(v => v.AsBsonDocument)
                    .Where(d => !d["_id"].IsBsonNull)
                    .Select(d => new OptionRow(
                        MslBrokers.ElevationNames.GetValueOrDefault(d["_id"].AsString, d["_id"].AsString),
                        null, d["lots"].ToInt64())).ToList(),
                BoolOpt("optSaleTypes", "private", "Private sale", "public", "Public auction"),
                BoolOpt("optSold", "sold", "Sold", "unsold", "Unsold"),
                BoolOpt("optRefuse", "only", "Refused tea", "exclude", "Non refused tea"));
        }
    }

    private static BsonDocument Branch(double from, double to, string label) => new()
    {
        ["case"] = new BsonDocument("$and", new BsonArray
        {
            new BsonDocument("$gte", new BsonArray { "$p", from }),
            new BsonDocument("$lt", new BsonArray { "$p", to }),
        }),
        ["then"] = label,
    };

    private static string ElevationCodeOf(string value) =>
        MslBrokers.ElevationNames.FirstOrDefault(kv =>
            kv.Value.Equals(value.Trim(), StringComparison.OrdinalIgnoreCase)).Key ?? value.Trim();

    /// <summary>MSL factory codes carry a letter infix for sub-marks (MFA0602) where the
    /// Excel "Trade Mark" writes the base code (MF0602) — same factory. Dropping the infix
    /// gives the family key both sides agree on.</summary>
    internal static string NormalizeFactory(string code) =>
        code.Length > 3 && char.IsLetter(code[2]) && char.IsDigit(code[3]) ? code[..2] + code[3..] : code;

    /// <summary>Normalized family → every MSL factory-code variant seen in the archive.</summary>
    private Task<Dictionary<string, List<string>>> FactoryFamiliesAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("msl:factoryfam:" + importer.DataVersion, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            var codes = await db.MslSaleStats.Distinct(s => s.Key, s => s.Dimension == "factory").ToListAsync(ct);
            return codes.GroupBy(NormalizeFactory, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        })!;
}
