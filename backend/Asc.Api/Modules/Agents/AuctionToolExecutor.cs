using System.Text.Json;
using Asc.Api.Models;
using Asc.Api.Modules.Assistant;
using Asc.Api.Services;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// AuctionAgent's tool surface — a strict subset of AssistantToolExecutor's catalogue-grounded
/// tools (never document search or deadline tracking, which aren't auction analysis), plus one
/// genuinely new tool (get_top_lots) that no existing endpoint exposed. The 7 reused tools
/// delegate straight to AssistantToolExecutor.ExecuteAsync — same computation, same code, never
/// re-implemented here — so this class owns *which* tools AuctionAgent may call, not their logic.
/// Deliberately excludes get_valuation_accuracy/get_market_insights (ASC-valuation-vs-actual
/// accuracy is a Market Intelligence concern, i.e. a future MarketAgent's territory, not this
/// one's) and search_knowledge_base/get_upcoming_deadlines (not auction analysis at all) — see
/// Modules/Agents/README.md for the full boundary rationale.
/// </summary>
public class AuctionToolExecutor(AssistantToolExecutor generalTools, ICatalogueSource source, ILogger<AuctionToolExecutor> logger)
{
    private const int MaxTopLots = 50;
    private const int DefaultTopLots = 10;

    private static readonly string[] ReusedToolNames =
    [
        "list_catalogues", "search_lots", "get_dashboard_stats", "compare_sales",
        "get_broker_performance", "get_breakdown", "get_top_prices", "get_performance_insights",
    ];

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        .. AssistantToolExecutor.Definitions.Where(d => ReusedToolNames.Contains(d.Name)),
        new ToolDef(
            "get_top_lots",
            "Get the top N lots in a catalogue ranked by actual auction purchase price " +
            "(the real settled price a buyer paid, not ASC's own pre-auction valuation estimate). " +
            "Only includes lots with a recorded purchase price. Use this for \"highest price\"/" +
            "\"top lots\" questions about real auction outcomes, as distinct from get_dashboard_stats " +
            "or get_breakdown, which report ASC's own valuation.",
            new
            {
                type = "object",
                properties = new
                {
                    catalogueId = new { type = "string", description = "The catalogue's id, from list_catalogues." },
                    n = new { type = "integer", description = $"How many lots to return. Default {DefaultTopLots}, max {MaxTopLots}." },
                },
                required = new[] { "catalogueId" },
            }),
    ];

    public static IReadOnlyList<ToolDef> DefinitionsFor(bool isAdmin) =>
        isAdmin ? Definitions : [.. Definitions.Where(d => !d.RequiresAdmin)];

    public async Task<string> ExecuteAsync(string name, string argumentsJson, bool isAdmin, CancellationToken ct = default)
    {
        if (Definitions.All(d => d.Name != name))
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' is not available to the Auction Agent." });

        if (name == "get_top_lots")
        {
            logger.LogInformation("Auction tool call: {Tool} isAdmin={IsAdmin} args={Args}", name, isAdmin, argumentsJson);
            try
            {
                var args = AssistantToolExecutor.ParseArgs(argumentsJson);
                var catalogueId = Guid.Parse(args["catalogueId"]!.GetValue<string>());
                var n = args["n"]?.GetValue<int>() ?? DefaultTopLots;
                return GetTopLots(catalogueId, n);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Auction tool call failed: {Tool} args={Args}", name, argumentsJson);
                return JsonSerializer.Serialize(new
                {
                    error = $"Tool '{name}' failed: {ex.Message}. If you used a placeholder or " +
                             "remembered id, call list_catalogues first to get a real catalogue id.",
                });
            }
        }

        // Every other advertised name is one of the reused tools — same implementation
        // GeneralAgent uses, including its own admin-gating, error-handling, and logging.
        return await generalTools.ExecuteAsync(name, argumentsJson, isAdmin, ct);
    }

    private string GetTopLots(Guid catalogueId, int n)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return JsonSerializer.Serialize(new { error = "Catalogue not found." });

        var result = ComputeTopLots(lots, n);
        // Projected to an explicit camelCase anonymous shape — same convention as every other
        // tool's output in this file (JsonSerializer.Serialize with no options doesn't camelCase
        // C# PascalCase properties on its own), so the model sees consistent field names
        // regardless of which tool it called.
        return JsonSerializer.Serialize(new
        {
            rows = result.Rows.Select(r => new
            {
                lotId = r.LotId,
                lotNumber = r.LotNumber,
                broker = r.Broker,
                grade = r.Grade,
                garden = r.Garden,
                sellingMark = r.SellingMark,
                purchasedPrice = r.PurchasedPrice,
                buyer = r.Buyer,
            }),
            pricedLotCount = result.PricedLotCount,
            totalLotCount = result.TotalLotCount,
        });
    }

    public sealed record TopLotRow(
        Guid LotId, string? LotNumber, string? Broker, string? Grade, string? Garden,
        string? SellingMark, decimal? PurchasedPrice, string? Buyer);

    public sealed record TopLotsResult(List<TopLotRow> Rows, int PricedLotCount, int TotalLotCount);

    /// <summary>Pure ranking logic, independently testable without a real ICatalogueSource — the
    /// instance method above only adds the "load lots for this catalogue id" step around this.
    /// Ranks by Lot.PurchasedPrice (the real settled auction price), never Valuation.EffectiveValue
    /// (ASC's own pre-auction estimate) — see the class-level doc comment on Lot.PurchasedPrice.</summary>
    internal static TopLotsResult ComputeTopLots(IReadOnlyList<Lot> lots, int n)
    {
        var priced = lots.Where(l => l.PurchasedPrice is > 0m).ToList();
        var top = priced
            .OrderByDescending(l => l.PurchasedPrice)
            .Take(Math.Clamp(n, 1, MaxTopLots))
            .Select(l => new TopLotRow(
                l.Id, l.LotNumber, l.Broker, l.Grade, l.Garden, l.SellingMark, l.PurchasedPrice, l.BuyerName ?? l.Buyer))
            .ToList();

        return new TopLotsResult(top, priced.Count, lots.Count);
    }
}
