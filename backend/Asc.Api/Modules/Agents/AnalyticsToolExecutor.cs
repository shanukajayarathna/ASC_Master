using System.Text.Json;
using Asc.Api.Data;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Msl;
using MongoDB.Driver;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// The Analytics Agent's tool set — every tool reads the MSL archive's materialized
/// rollups (mslSaleStats) or bounded slices of auctionLots, so a chat answer never
/// triggers a whole-archive scan. Strictly read-only.
/// </summary>
public class AnalyticsToolExecutor(MongoContext db, ILogger<AnalyticsToolExecutor> logger)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static readonly IReadOnlyList<ToolDef> Definitions =
    [
        new("list_sales",
            "Lists auction sales (newest first) with headline numbers: lots, sold lots, total and " +
            "sold quantity (kg), proceeds (Rs), and quantity-weighted average price (Rs/kg). " +
            "Each sale's figures include both public-auction and private-sale transactions of " +
            "that sale week.",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Restrict to one year (e.g. 2026). Omit for the most recent sales across years." },
                    n = new { type = "string", description = "How many sales to return. Default 10, max 60." },
                },
            }),
        new("get_sale_breakdown",
            "One sale's statistics grouped by a dimension: broker, elevation, grade, buyer, mark " +
            "(selling mark/estate), or priceRange. Returns lots, sold lots, quantities (kg), " +
            "proceeds (Rs) and weighted average price (Rs/kg) per group — the same numbers as the " +
            "Analysis dashboards. IMPORTANT: rows are sorted by total quantity (largest first), " +
            "NOT by price — to answer 'highest/lowest average price', compare the avgPriceRs " +
            "field across ALL returned rows, never assume the first row.",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Sale year, e.g. 2026." },
                    saleNo = new { type = "string", description = "Sale number within the year (1-51). 0 = the year's private sales." },
                    dimension = new { type = "string", description = "broker | elevation | grade | buyer | mark | priceRange | total" },
                    n = new { type = "string", description = "Max groups to return, by quantity. Default 15, max 60." },
                },
                required = new[] { "year", "saleNo", "dimension" },
            }),
        new("compare_sales",
            "Compares two sales on one dimension (or 'total'): the same measures side by side " +
            "with differences. Useful for sale-on-sale or year-on-year movement.",
            new
            {
                type = "object",
                properties = new
                {
                    year1 = new { type = "string" },
                    saleNo1 = new { type = "string" },
                    year2 = new { type = "string" },
                    saleNo2 = new { type = "string" },
                    dimension = new { type = "string", description = "total | broker | elevation | grade | buyer | priceRange" },
                },
                required = new[] { "year1", "saleNo1", "year2", "saleNo2", "dimension" },
            }),
        new("mark_history",
            "A selling mark's (estate brand's) auction history across the archive: per-sale " +
            "quantity, sold %, and weighted average price. Mark matching is starts-with, " +
            "case-insensitive (e.g. 'KENILWORTH').",
            new
            {
                type = "object",
                properties = new
                {
                    mark = new { type = "string", description = "Selling mark prefix, e.g. KENILWORTH." },
                    yearFrom = new { type = "string", description = "First year to include. Default: 3 years back." },
                    yearTo = new { type = "string", description = "Last year to include. Default: current year." },
                },
                required = new[] { "mark" },
            }),
        new("get_teaboard_averages",
            "Official Sri Lanka Tea Board monthly national elevational averages (2018–present): " +
            "month + year-to-date quantity and average by elevation, per section " +
            "(ORTHODOX/CTC/COMBINED/GREEN/ORGANIC/SPECIAL/REFUSE/COMPOSITE).",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string" },
                    month = new { type = "string", description = "1-12; omit for the whole year." },
                    section = new { type = "string", description = "Default COMBINED." },
                },
                required = new[] { "year" },
            }),
    ];

    public static IReadOnlyList<ToolDef> DefinitionsFor(bool _) => Definitions;

    public async Task<string> ExecuteAsync(string name, string argumentsJson, bool isAdmin, CancellationToken ct = default)
    {
        if (Definitions.All(d => d.Name != name))
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' is not available to the Analytics Agent." });
        logger.LogInformation("Analytics tool call: {Tool} args={Args}", name, argumentsJson);
        try
        {
            var args = AssistantToolExecutor.ParseArgs(argumentsJson);
            // Some models (notably Llama via Groq) emit integers as JSON strings ("10");
            // read numbers tolerantly rather than failing the whole tool call.
            int? OptInt(string key) => args[key] is { } node
                ? node.GetValueKind() == System.Text.Json.JsonValueKind.String
                    ? int.TryParse(node.GetValue<string>(), out var v) ? v : null
                    : node.GetValue<int>()
                : null;
            int ReqInt(string key) => OptInt(key) ?? throw new ArgumentException($"Missing required integer argument '{key}'.");

            return name switch
            {
                "list_sales" => await ListSales(OptInt("year"), OptInt("n") ?? 10, ct),
                "get_sale_breakdown" => await SaleBreakdown(
                    ReqInt("year"), ReqInt("saleNo"),
                    args["dimension"]!.GetValue<string>(), OptInt("n") ?? 15, ct),
                "compare_sales" => await CompareSales(
                    ReqInt("year1"), ReqInt("saleNo1"), ReqInt("year2"), ReqInt("saleNo2"),
                    args["dimension"]!.GetValue<string>(), ct),
                "mark_history" => await MarkHistory(
                    args["mark"]!.GetValue<string>(), OptInt("yearFrom"), OptInt("yearTo"), ct),
                "get_teaboard_averages" => await TeaBoard(
                    ReqInt("year"), OptInt("month"),
                    args["section"]?.GetValue<string>() ?? "COMBINED", ct),
                _ => JsonSerializer.Serialize(new { error = "Unhandled tool." }),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Analytics tool call failed: {Tool} args={Args}", name, argumentsJson);
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' failed: {ex.Message}" });
        }
    }

    private async Task<string> ListSales(int? year, int n, CancellationToken ct)
    {
        n = Math.Clamp(n, 1, 60);
        var fb = Builders<MslSaleStat>.Filter;
        var filter = fb.Eq(s => s.Dimension, "total");
        if (year is not null) filter &= fb.Eq(s => s.Year, year.Value);
        var rows = await db.MslSaleStats.Find(filter)
            .SortByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).Limit(n).ToListAsync(ct);
        return JsonSerializer.Serialize(rows.Select(Shape), Json);
    }

    private async Task<string> SaleBreakdown(int year, int saleNo, string dimension, int n, CancellationToken ct)
    {
        n = Math.Clamp(n, 1, 60);
        var rows = await db.MslSaleStats
            .Find(s => s.Year == year && s.SaleNo == saleNo && s.Dimension == dimension.Trim())
            .SortByDescending(s => s.TotalQtyKg).Limit(n).ToListAsync(ct);
        if (rows.Count == 0)
            return JsonSerializer.Serialize(new { error = $"No data for sale {saleNo} of {year} (dimension '{dimension}'). Valid dimensions: total, broker, elevation, grade, buyer, mark, priceRange." });
        return JsonSerializer.Serialize(rows.Select(Shape), Json);
    }

    private async Task<string> CompareSales(int y1, int s1, int y2, int s2, string dimension, CancellationToken ct)
    {
        var a = await db.MslSaleStats.Find(s => s.Year == y1 && s.SaleNo == s1 && s.Dimension == dimension)
            .SortByDescending(s => s.TotalQtyKg).Limit(25).ToListAsync(ct);
        var b = await db.MslSaleStats.Find(s => s.Year == y2 && s.SaleNo == s2 && s.Dimension == dimension)
            .SortByDescending(s => s.TotalQtyKg).Limit(25).ToListAsync(ct);
        if (a.Count == 0 || b.Count == 0)
            return JsonSerializer.Serialize(new { error = "One or both sales have no data for that dimension." });
        return JsonSerializer.Serialize(new
        {
            saleA = new { year = y1, saleNo = s1, rows = a.Select(Shape) },
            saleB = new { year = y2, saleNo = s2, rows = b.Select(Shape) },
        }, Json);
    }

    private async Task<string> MarkHistory(string mark, int? yearFrom, int? yearTo, CancellationToken ct)
    {
        var to = yearTo ?? DateTime.UtcNow.Year;
        var from = yearFrom ?? to - 3;
        var prefix = mark.Trim().ToUpperInvariant();
        var fb = Builders<MslSaleStat>.Filter;
        var rows = await db.MslSaleStats.Find(
                fb.Eq(s => s.Dimension, "mark") &
                fb.Gte(s => s.Year, from) & fb.Lte(s => s.Year, to) &
                fb.Regex(s => s.Key, new MongoDB.Bson.BsonRegularExpression("^" + System.Text.RegularExpressions.Regex.Escape(prefix))))
            .SortBy(s => s.Year).ThenBy(s => s.SaleNo).Limit(220).ToListAsync(ct);
        if (rows.Count == 0)
            return JsonSerializer.Serialize(new { error = $"No sales found for mark '{prefix}' in {from}-{to}." });
        return JsonSerializer.Serialize(rows.Select(s => new
        {
            s.Year,
            s.SaleNo,
            mark = s.Key,
            estate = s.Label,
            lots = s.Lots,
            soldLots = s.SoldLots,
            totalQtyKg = Math.Round(s.TotalQtyKg, 0),
            avgPriceRs = s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : (decimal?)null,
        }), Json);
    }

    private async Task<string> TeaBoard(int year, int? month, string section, CancellationToken ct)
    {
        var fb = Builders<TeaBoardAverage>.Filter;
        var filter = fb.Eq(t => t.Year, year) & fb.Eq(t => t.Section, section.ToUpperInvariant());
        if (month is not null) filter &= fb.Eq(t => t.Month, month.Value);
        var rows = await db.TeaBoardAverages.Find(filter)
            .SortBy(t => t.Month).ThenBy(t => t.Elevation).Limit(150).ToListAsync(ct);
        if (rows.Count == 0)
            return JsonSerializer.Serialize(new { error = $"No Tea Board rows for {section} {year}{(month is null ? "" : $"-{month:00}")}. Sections: ORTHODOX, CTC, COMBINED, GREEN, ORGANIC, SPECIAL, REFUSE, COMPOSITE." });
        return JsonSerializer.Serialize(rows.Select(t => new
        {
            t.Year, t.Month, t.Elevation, t.MonthQtyKg, t.MonthAvgRs, t.TodateQtyKg, t.TodateAvgRs,
        }), Json);
    }

    private static object Shape(MslSaleStat s) => new
    {
        s.Year,
        s.SaleNo,
        saleDate = s.SaleDate.ToString("yyyy-MM-dd"),
        key = s.Key,
        label = s.Label,
        lots = s.Lots,
        soldLots = s.SoldLots,
        totalQtyKg = Math.Round(s.TotalQtyKg, 0),
        soldQtyKg = Math.Round(s.SoldQtyKg, 0),
        proceedsRs = Math.Round(s.ProceedsRs, 0),
        avgPriceRs = s.SoldQtyKg > 0 ? Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : (decimal?)null,
    };
}
