using System.Text.Json;
using System.Text.Json.Nodes;
using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Documents;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// The assistant's read-only tool surface — no auto-editing tickets, matching the
/// optimistic-concurrency protection already on valuation saves. Every tool here calls into
/// existing seams/logic (ICatalogueSource, MongoContext, LotsController.Merged,
/// DashboardController.Compute, IDocumentSearchService) rather than re-implementing anything.
/// </summary>
public class AssistantToolExecutor(ICatalogueSource source, MongoContext db, IDocumentSearchService search)
{
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
    ];

    public async Task<string> ExecuteAsync(string name, string argumentsJson, CancellationToken ct = default)
    {
        var args = string.IsNullOrWhiteSpace(argumentsJson) ? new JsonObject() : JsonNode.Parse(argumentsJson)!.AsObject();

        return name switch
        {
            "list_catalogues" => ListCatalogues(),
            "search_lots" => await SearchLots(Guid.Parse(args["catalogueId"]!.GetValue<string>()), args["query"]!.GetValue<string>(), ct),
            "get_dashboard_stats" => await GetDashboardStats(Guid.Parse(args["catalogueId"]!.GetValue<string>()), ct),
            "search_knowledge_base" => JsonSerializer.Serialize(await search.SearchAsync(args["query"]!.GetValue<string>(), ct)),
            _ => JsonSerializer.Serialize(new { error = $"Unknown tool '{name}'." }),
        };
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
}
