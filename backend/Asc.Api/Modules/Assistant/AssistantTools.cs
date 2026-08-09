using System.Text.Json;
using System.Text.Json.Nodes;
using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Analytics;
using Asc.Api.Modules.AuctionReports;
using Asc.Api.Modules.Documents;
using Asc.Api.Modules.Market;
using Asc.Api.Modules.Reports;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// The assistant's read-only tool surface — no auto-editing tickets, matching the
/// optimistic-concurrency protection already on valuation saves. Every tool here calls into
/// existing seams/logic (ICatalogueSource, MongoContext, LotsController.Merged,
/// DashboardController.Compute, MarketController's accuracy statics, AnalyticsController's
/// broker stats, ReportGenerator's group sections, TopPriceEngine, IDocumentSearchService)
/// rather than re-implementing anything.
/// </summary>
public class AssistantToolExecutor(
    ICatalogueSource source, MongoContext db, IDocumentSearchService search,
    TopPriceEngine engine, ILogger<AssistantToolExecutor> logger)
{
    // compare_sales' cap must not exceed SaleFileStore.MaxLoadedSales — otherwise a single
    // comparison call can evict its own earlier sales from the in-memory LRU mid-request,
    // forcing a re-parse (~25s/file cold) and thrashing the cache for every other concurrent
    // user hitting Dashboard/Analytics on those same sales.
    private const int MaxCompareSales = 4;

    private static readonly Dictionary<string, (string Label, Func<Lot, string?> Selector)> BreakdownSelectors = new()
    {
        ["broker"] = ("Broker", l => l.Broker),
        ["grade"] = ("Grade", l => l.Grade),
        ["category"] = ("Category", l => l.Category),
        ["garden"] = ("Garden", l => l.Garden),
        ["elevation"] = ("Elevation", l => l.Elevation),
        ["region"] = ("Region", l => l.Region),
        ["warehouse"] = ("Warehouse", l => l.Warehouse),
    };

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        new ToolDef(
            "list_catalogues",
            "List the sale catalogues currently loaded, with their id, source file name, row count, and import date. Call this first if you don't already know which catalogue id to use for search_lots or get_dashboard_stats.",
            new { type = "object", properties = new { }, required = Array.Empty<string>() }),

        new ToolDef(
            "search_lots",
            "Search lots within a specific catalogue by lot number, garden, grade, broker, or category. Returns up to 10 matches with their current valuation.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." },
                    query = new { type = "string", description = "Text to search for, e.g. a lot number, garden name, or grade." },
                },
                required = new[] { "catalogueId", "query" },
            }),

        new ToolDef(
            "get_dashboard_stats",
            "Get aggregate valuation statistics for a catalogue: totals, completion, average/min/max value, most common broker/grade/category/elevation.",
            new
            {
                type = "object",
                properties = new { catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." } },
                required = new[] { "catalogueId" },
            }),

        new ToolDef(
            "search_knowledge_base",
            "Search uploaded documents (circulars, SOPs, policies) for relevant passages.",
            new
            {
                type = "object",
                properties = new { query = new { type = "string", description = "What to search for." } },
                required = new[] { "query" },
            }),

        new ToolDef(
            "compare_sales",
            $"Compare aggregate stats (lot count, completion, avg/min/max value, most common broker/grade/category/elevation) " +
            $"across 2 to {MaxCompareSales} sale catalogues. Call list_catalogues first to resolve sale numbers to catalogue ids. " +
            "For a single sale use get_dashboard_stats instead.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueIds = new
                    {
                        type = "array",
                        items = new { type = "string" },
                        description = $"2 to {MaxCompareSales} catalogue ids, from list_catalogues.",
                    },
                },
                required = new[] { "catalogueIds" },
            }),

        new ToolDef(
            "get_valuation_accuracy",
            "Get valuation accuracy (MAPE, RMSE, mean bias, total over/under-valuation) for a catalogue by comparing this " +
            "company's valuations to imported actual auction prices. Optionally break down by broker, grade, or elevation. " +
            "Returns lotsCompared: 0 if no actuals have been imported for this catalogue.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." },
                    breakdownBy = new { type = "string", @enum = new[] { "broker", "grade", "elevation" }, description = "Optional grouping dimension." },
                },
                required = new[] { "catalogueId" },
            }),

        new ToolDef(
            "get_broker_performance",
            "Get per-broker performance stats for a catalogue: lot count, share of total, avg/min/max valuation, top " +
            "grade/category, total net weight. Ordered by average valuation descending.",
            new
            {
                type = "object",
                properties = new { catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." } },
                required = new[] { "catalogueId" },
            }),

        new ToolDef(
            "get_market_insights",
            "Get auto-generated valuation-accuracy findings for a catalogue — grades, elevations, or brokers where actual " +
            "prices significantly diverged (over- or under-valued) from this company's valuation, based on imported " +
            "actuals. Empty if fewer than 3 lots support a bucket or no actuals imported.",
            new
            {
                type = "object",
                properties = new { catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." } },
                required = new[] { "catalogueId" },
            }),

        new ToolDef(
            "get_breakdown",
            "Get lot count and average value grouped by a dimension (broker, grade, category, garden, elevation, region, " +
            "warehouse) for a catalogue, or lot count by valuation classification tier.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." },
                    column = new
                    {
                        type = "string",
                        @enum = new[] { "broker", "grade", "category", "garden", "elevation", "region", "warehouse", "classification" },
                    },
                },
                required = new[] { "catalogueId", "column" },
            }),

        new ToolDef(
            "get_top_prices",
            "Get the cross-broker top-3-price-per-grade ranking for a catalogue (who held 1st/2nd/3rd place and whether " +
            "ASC placed), for one of: top-prices (default), ctc, off-grades-dust, low-grown-premium-flowery.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." },
                    reportKey = new
                    {
                        type = "string",
                        @enum = new[] { "top-prices", "ctc", "off-grades-dust", "low-grown-premium-flowery" },
                    },
                },
                required = new[] { "catalogueId" },
            }),
    ];

    public static IReadOnlyList<ToolDef> DefinitionsFor(bool isAdmin) =>
        isAdmin ? Definitions : [.. Definitions.Where(d => !d.RequiresAdmin)];

    public async Task<string> ExecuteAsync(string name, string argumentsJson, bool isAdmin, CancellationToken ct = default)
    {
        var def = Definitions.FirstOrDefault(d => d.Name == name);
        if (def is null) return JsonSerializer.Serialize(new { error = $"Unknown tool '{name}'." });
        if (def.RequiresAdmin && !isAdmin)
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' requires an Admin account." });

        logger.LogInformation("Assistant tool call: {Tool} isAdmin={IsAdmin} args={Args}", name, isAdmin, argumentsJson);

        // Some providers (observed with Groq) send the literal JSON string "null" — not an
        // empty string — as arguments for a no-arg tool call. JsonNode.Parse("null") returns a
        // null node, so blindly null-forgiving it into a JsonObject would throw. Any parse
        // result that isn't actually an object (null, an array, a scalar) falls back to empty.
        var trimmed = argumentsJson?.Trim();
        var args = string.IsNullOrEmpty(trimmed) || trimmed == "null"
            ? new JsonObject()
            : JsonNode.Parse(trimmed) as JsonObject ?? new JsonObject();

        // A less precise model can send a malformed/placeholder id (e.g. "latest") instead of
        // calling list_catalogues first, or omit a required field entirely. Turning that into a
        // JSON tool-error — the same shape as the "Unknown tool"/"requires Admin" errors above —
        // lets the model see the problem and retry within its own tool loop, instead of an
        // unhandled exception here killing the whole gateway call for every provider.
        try
        {
            return name switch
            {
                "list_catalogues" => ListCatalogues(),
                "search_lots" => await SearchLots(Guid.Parse(args["catalogueId"]!.GetValue<string>()), args["query"]!.GetValue<string>(), ct),
                "get_dashboard_stats" => await GetDashboardStats(Guid.Parse(args["catalogueId"]!.GetValue<string>()), ct),
                "search_knowledge_base" => JsonSerializer.Serialize(await search.SearchAsync(args["query"]!.GetValue<string>(), ct)),
                "compare_sales" => await CompareSales([.. args["catalogueIds"]!.AsArray().Select(n => Guid.Parse(n!.GetValue<string>()))], ct),
                "get_valuation_accuracy" => await GetValuationAccuracy(
                    Guid.Parse(args["catalogueId"]!.GetValue<string>()), args["breakdownBy"]?.GetValue<string>(), ct),
                "get_broker_performance" => await GetBrokerPerformance(Guid.Parse(args["catalogueId"]!.GetValue<string>()), ct),
                "get_market_insights" => await GetMarketInsights(Guid.Parse(args["catalogueId"]!.GetValue<string>()), ct),
                "get_breakdown" => await GetBreakdown(Guid.Parse(args["catalogueId"]!.GetValue<string>()), args["column"]!.GetValue<string>(), ct),
                "get_top_prices" => GetTopPrices(Guid.Parse(args["catalogueId"]!.GetValue<string>()), args["reportKey"]?.GetValue<string>() ?? "top-prices"),
                _ => JsonSerializer.Serialize(new { error = $"Unknown tool '{name}'." }),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Assistant tool call failed: {Tool} args={Args}", name, argumentsJson);
            return JsonSerializer.Serialize(new
            {
                error = $"Tool '{name}' failed: {ex.Message}. If you used a placeholder or " +
                         "remembered id, call list_catalogues first to get a real catalogue id.",
            });
        }
    }

    private string ListCatalogues() =>
        JsonSerializer.Serialize(source.ListCatalogues().Select(c => new
        {
            id = c.Id,
            sourceName = c.SourceName,
            rowCount = c.RowCount,
            importedAt = c.ImportedAt,
        }));

    private async Task<string> SearchLots(Guid catalogueId, string query, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });

        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct))
            .ToDictionary(v => v.LotId, v => v.Valuation);

        var q = query.Trim();
        bool Matches(Lot l) =>
            (l.LotNumber?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (l.Garden?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (l.Grade?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (l.Broker?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (l.Category?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false);

        var results = lots.Where(Matches).Take(10).Select(l =>
        {
            var val = LotsController.Merged(l, overrides);
            return new
            {
                lotId = l.Id,
                lotNumber = l.LotNumber,
                broker = l.Broker,
                grade = l.Grade,
                garden = l.Garden,
                category = l.Category,
                effectiveValue = val?.EffectiveValue,
                classification = val?.Classification.ToString(),
            };
        }).ToList();

        return JsonSerializer.Serialize(results);
    }

    private async Task<string> GetDashboardStats(Guid catalogueId, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null || lots.Count == 0) return JsonSerializer.Serialize(new { error = "Catalogue not found or empty." });

        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct))
            .ToDictionary(v => v.LotId, v => v.Valuation);
        var merged = lots.Select(l => (Lot: l, Val: LotsController.Merged(l, overrides))).ToList();

        return JsonSerializer.Serialize(DashboardController.Compute(merged));
    }

    private async Task<List<(Lot Lot, Valuation? Val)>?> LoadMerged(Guid catalogueId, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return null;
        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct))
            .ToDictionary(v => v.LotId, v => v.Valuation);
        return lots.Select(l => (Lot: l, Val: LotsController.Merged(l, overrides))).ToList();
    }

    private async Task<string> CompareSales(List<Guid> catalogueIds, CancellationToken ct)
    {
        if (catalogueIds.Count is < 2 or > MaxCompareSales)
            return JsonSerializer.Serialize(new { error = $"compare_sales supports 2 to {MaxCompareSales} catalogues per call — narrow your request." });

        var results = new List<object>();
        foreach (var id in catalogueIds)
        {
            var merged = await LoadMerged(id, ct);
            if (merged is null) continue;
            var catalogue = source.GetCatalogue(id);
            results.Add(new { catalogueId = id, sourceName = catalogue?.SourceName, stats = DashboardController.Compute(merged) });
        }

        return JsonSerializer.Serialize(results);
    }

    private async Task<string> GetValuationAccuracy(Guid catalogueId, string? breakdownBy, CancellationToken ct)
    {
        var pairs = await MarketController.BuildPairs(source, db, catalogueId, ct);
        if (pairs is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });

        if (breakdownBy is null)
            return JsonSerializer.Serialize(MarketController.ComputeAccuracy(pairs));

        if (!MarketController.BreakdownColumns.TryGetValue(breakdownBy, out var selector))
            return JsonSerializer.Serialize(new { error = $"Unknown breakdownBy '{breakdownBy}'. Use broker, grade, or elevation." });

        return JsonSerializer.Serialize(MarketController.ComputeBreakdown(pairs, selector));
    }

    private async Task<string> GetBrokerPerformance(Guid catalogueId, CancellationToken ct)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });
        return JsonSerializer.Serialize(AnalyticsController.ComputeBrokerStats(merged));
    }

    private async Task<string> GetMarketInsights(Guid catalogueId, CancellationToken ct)
    {
        var pairs = await MarketController.BuildPairs(source, db, catalogueId, ct);
        if (pairs is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });
        return JsonSerializer.Serialize(MarketController.ComputeInsights(pairs));
    }

    private async Task<string> GetBreakdown(Guid catalogueId, string column, CancellationToken ct)
    {
        var merged = await LoadMerged(catalogueId, ct);
        if (merged is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });

        if (column == "classification")
            return JsonSerializer.Serialize(ReportGenerator.ClassificationSection(merged).Groups);

        if (!BreakdownSelectors.TryGetValue(column, out var def))
            return JsonSerializer.Serialize(new { error = $"Unknown breakdown column '{column}'." });

        return JsonSerializer.Serialize(ReportGenerator.GroupSection(def.Label, def.Label, merged, def.Selector).Groups);
    }

    // Flattened, not the raw AuctionReportDto — its nested Sheets → Blocks → Grades → Rows tree
    // can carry hundreds of ranked rows per catalogue, far more than a chat answer needs or an
    // LLM context should be spent on. One row per grade block (its outright top price), capped
    // and flagged so the model can tell the user if results were cut.
    private string GetTopPrices(Guid catalogueId, string reportKey)
    {
        var lots = source.GetLots(catalogueId);
        var catalogue = source.GetCatalogue(catalogueId);
        if (lots is null || catalogue is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });

        var report = engine.Build(reportKey, [.. lots], catalogue.SourceName);
        if (report is null) return JsonSerializer.Serialize(new { error = $"Unknown reportKey '{reportKey}'." });

        var rows = report.Sheets
            .SelectMany(s => s.Blocks)
            .SelectMany(b => b.Grades)
            .Where(g => g.Rows.Count > 0)
            .Select(g =>
            {
                var top = g.Rows.First(r => r.Rank == 1);
                return new
                {
                    grade = g.Grade,
                    topBroker = top.Broker,
                    topPrice = top.Price,
                    ascPlaced = g.Rows.Any(r => r.IsOurs),
                    ascRank = g.Rows.Where(r => r.IsOurs).Select(r => (int?)r.Rank).FirstOrDefault(),
                    remark = g.Rows.FirstOrDefault(r => r.IsOurs)?.Remark,
                };
            })
            .OrderByDescending(r => r.topPrice)
            .ToList();

        const int cap = 25;
        return JsonSerializer.Serialize(new { rows = rows.Take(cap), truncated = rows.Count > cap });
    }
}
