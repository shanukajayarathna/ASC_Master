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
public class AnalyticsToolExecutor(
    MongoContext db,
    Asc.Api.Modules.Msl.MslExcelExportService excel,
    Asc.Api.Modules.Msl.MslReportExportService reportExports,
    ILogger<AnalyticsToolExecutor> logger)
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
                    broker = new { type = "string", description = "Optional: restrict to ONE broker (short code ASC/BC/CT/EB/FW/JK/LC/MPB). E.g. dimension=buyer + broker=ASC gives that broker's buyers." },
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
        new("generate_excel",
            "Generates a downloadable Excel workbook of MSL analytics for one sale or a whole " +
            "year: Summary, Brokers, Grade Mix, Elevations, Buyers, Selling Marks, Price " +
            "Ranges sheets, plus Invoice Lines when a single sale is exported. Returns a " +
            "download link — present it to the user as a markdown link whose TEXT is the " +
            "file name, e.g. [msl-analytics-2026-sale30.xlsx](/api/v1/msl/analytics/export/abc).",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Year to export, e.g. 2026." },
                    saleNo = new { type = "string", description = "Sale number for a single-sale workbook (includes invoice lines). Omit for the whole year." },
                },
                required = new[] { "year" },
            }),
        new("generate_pdf",
            "Generates a downloadable PDF report of MSL analytics for one sale or a whole year: " +
            "an Overview KPI page, then a page per dimension (Brokers, Grade Mix, Elevations, " +
            "Selling Marks, Buyers) showing its top rows — a readable print/share summary, NOT " +
            "the full data dump generate_excel gives. Returns a download link — present it as a " +
            "markdown link whose TEXT is the file name.",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Year to export, e.g. 2026." },
                    saleNo = new { type = "string", description = "Sale number for a single-sale report. Omit for the whole year." },
                },
                required = new[] { "year" },
            }),
        new("generate_presentation",
            "Generates a downloadable PowerPoint (.pptx) deck of MSL analytics for one sale or a " +
            "whole year: a title slide, then one slide per dimension (Brokers, Grade Mix, " +
            "Elevations, Selling Marks, Buyers) with its top rows as plain text — the same scope " +
            "as generate_pdf, as slides instead of pages. Returns a download link — present it " +
            "as a markdown link whose TEXT is the file name.",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Year to export, e.g. 2026." },
                    saleNo = new { type = "string", description = "Sale number for a single-sale deck. Omit for the whole year." },
                },
                required = new[] { "year" },
            }),
        new("mark_broker_history",
            "A selling mark's auction history split BY BROKER \u2014 built for broker-switch " +
            "analysis: which broker sold the mark in each sale, per-broker period summaries, " +
            "and computed transitions showing the quantity-weighted average price before vs " +
            "after each broker change. Use this whenever the user asks how a mark was " +
            "affected by changing broker, or about its development after a switch.",
            new
            {
                type = "object",
                properties = new
                {
                    mark = new { type = "string", description = "Selling mark, exact or prefix, e.g. CEYENTA." },
                    yearFrom = new { type = "string", description = "First year. Default: 4 years back." },
                    yearTo = new { type = "string", description = "Last year. Default: current year." },
                },
                required = new[] { "mark" },
            }),
        new("scan_mark_performance",
            "Business-development, retention and performance scanner over ALL selling marks. It " +
            "computes each mark's quantity-weighted price premium vs the overall market average " +
            "of the very same sales it sold in, so different price eras compare fairly. Modes: " +
            "'recruit_leads' = marks currently with OTHER brokers that performed BETTER during " +
            "a past tenure with the given broker (use for 'which marks could we win over / get " +
            "to Asia Siyaka'); 'gained_improved' = marks that joined the broker and improved vs " +
            "their previous broker (retention/pitch evidence); 'at_risk' = marks that LEFT the " +
            "broker and are now performing notably BETTER elsewhere (use for 'which marks are we " +
            "losing ground on / why did they leave' — an early-warning and root-cause list, the " +
            "opposite framing of recruit_leads over the same underlying data); 'top' / 'bottom' " +
            "= best and worst market-relative performers overall or within one broker " +
            "(performance / problem detector).",
            new
            {
                type = "object",
                properties = new
                {
                    mode = new { type = "string", description = "recruit_leads | gained_improved | at_risk | top | bottom" },
                    broker = new { type = "string", description = "Broker short code (ASC/BC/CT/EB/FW/JK/LC/MPB). Required for recruit_leads, gained_improved and at_risk; optional filter for top/bottom." },
                    yearFrom = new { type = "string", description = "First year. Default: 5 years back." },
                    yearTo = new { type = "string", description = "Last year. Default: current year." },
                    minQtyKg = new { type = "string", description = "Minimum sold kg per broker tenure to qualify. Default 10000." },
                    n = new { type = "string", description = "Rows to return. Default 15, max 40." },
                },
                required = new[] { "mode" },
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
                    args["dimension"]!.GetValue<string>(), OptInt("n") ?? 15,
                    args["broker"]?.GetValue<string>(), ct),
                "compare_sales" => await CompareSales(
                    ReqInt("year1"), ReqInt("saleNo1"), ReqInt("year2"), ReqInt("saleNo2"),
                    args["dimension"]!.GetValue<string>(), ct),
                "scan_mark_performance" => await ScanMarkPerformance(
                    args["mode"]!.GetValue<string>(), args["broker"]?.GetValue<string>(),
                    OptInt("yearFrom"), OptInt("yearTo"), OptInt("minQtyKg") ?? 10_000, OptInt("n") ?? 15, ct),
                "mark_broker_history" => await MarkBrokerHistory(
                    args["mark"]!.GetValue<string>(), OptInt("yearFrom"), OptInt("yearTo"), ct),
                "mark_history" => await MarkHistory(
                    args["mark"]!.GetValue<string>(), OptInt("yearFrom"), OptInt("yearTo"), ct),
                "generate_excel" => await GenerateExcel(ReqInt("year"), OptInt("saleNo"), ct),
                "generate_pdf" => await GeneratePdf(ReqInt("year"), OptInt("saleNo"), ct),
                "generate_presentation" => await GeneratePresentation(ReqInt("year"), OptInt("saleNo"), ct),
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

    /// <summary>Resolves a user/model-supplied broker string (short code like "ASC", or the raw
    /// MSL code like "AS") to (displayCode, mslCode) — null mslCode means unrecognized. Pure and
    /// static so it's unit-testable without a database. The exact resolution rule two call sites
    /// used to duplicate inline.</summary>
    internal static (string Code, string? MslCode) ResolveBroker(string broker)
    {
        var code = broker.Trim().ToUpperInvariant();
        var msl = Asc.Api.Modules.Msl.MslBrokers.ExcelCodeToMslCode.TryGetValue(code, out var mapped) ? mapped
            : Asc.Api.Modules.Msl.MslBrokers.CodeToName.ContainsKey(code) ? code : null;
        return (code, msl);
    }

    /// <summary>Normalizes a mark argument into a safe, anchored search prefix — rejecting blank
    /// or too-short input, which would otherwise turn "^" + regex into a match against every
    /// document in a 6.9M-row collection (a model passing an empty string is a real failure mode,
    /// not hypothetical: weak models occasionally omit required string arguments as "").</summary>
    internal static string? NormalizeMarkPrefix(string mark)
    {
        var trimmed = mark.Trim().ToUpperInvariant();
        return trimmed.Length < 2 ? null : trimmed;
    }

    /// <summary>Pre-formats rows as a markdown table so the model can paste figures
    /// VERBATIM instead of retyping them — retyped digits are how wrong numbers happen.</summary>
    private static string MarkdownTable(IEnumerable<(string Name, long Lots, long SoldLots, decimal SoldQty, decimal Proceeds, decimal? Avg)> rows, string nameHeader)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"| # | {nameHeader} | Lots | Sold lots | Sold qty (kg) | Proceeds (Rs) | Avg (Rs/kg) |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");
        int i = 1;
        foreach (var r in rows)
            sb.AppendLine($"| {i++} | {r.Name} | {r.Lots:N0} | {r.SoldLots:N0} | {r.SoldQty:N0} | {r.Proceeds:N0} | {(r.Avg is null ? "-" : r.Avg.Value.ToString("N2"))} |");
        return sb.ToString().TrimEnd();
    }

    private async Task<string> GenerateExcel(int year, int? saleNo, CancellationToken ct)
    {
        var (id, fileName, sheets) = await excel.GenerateAsync(year, saleNo, ct);
        return JsonSerializer.Serialize(new
        {
            downloadUrl = $"/api/v1/msl/analytics/export/{id}",
            fileName,
            sheets,
            expiresInMinutes = 20,
            instruction = "Give the user this as a markdown link with the file name as the link text.",
        }, Json);
    }

    private async Task<string> GeneratePdf(int year, int? saleNo, CancellationToken ct)
    {
        var (id, fileName) = await reportExports.GeneratePdfAsync(year, saleNo, ct);
        return JsonSerializer.Serialize(new
        {
            downloadUrl = $"/api/v1/msl/analytics/export/{id}",
            fileName,
            expiresInMinutes = 20,
            instruction = "Give the user this as a markdown link with the file name as the link text.",
        }, Json);
    }

    private async Task<string> GeneratePresentation(int year, int? saleNo, CancellationToken ct)
    {
        var (id, fileName) = await reportExports.GeneratePresentationAsync(year, saleNo, ct);
        return JsonSerializer.Serialize(new
        {
            downloadUrl = $"/api/v1/msl/analytics/export/{id}",
            fileName,
            expiresInMinutes = 20,
            instruction = "Give the user this as a markdown link with the file name as the link text.",
        }, Json);
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

    private async Task<string> SaleBreakdown(int year, int saleNo, string dimension, int n, string? broker, CancellationToken ct)
    {
        n = Math.Clamp(n, 1, 60);

        if (!string.IsNullOrWhiteSpace(broker))
            return await BrokerScopedBreakdown(year, saleNo, dimension.Trim().ToLowerInvariant(), broker.Trim(), n, ct);

        var dim = dimension.Trim();
        var rows = await db.MslSaleStats
            .Find(s => s.Year == year && s.SaleNo == saleNo && s.Dimension == dim)
            .SortByDescending(s => dim == "buyer" ? s.SoldQtyKg : s.TotalQtyKg).Limit(n).ToListAsync(ct);
        if (rows.Count == 0)
        {
            // Tell the model what IS available so it recovers in one step instead of looping.
            var latest = await db.MslSaleStats
                .Find(s => s.Year == year && s.Dimension == "total")
                .SortByDescending(s => s.SaleNo).Limit(1).FirstOrDefaultAsync(ct);
            var hint = latest is null
                ? $"Year {year} has no data at all."
                : $"The latest available sale of {year} is sale {latest.SaleNo}. Use that, or ask the user.";
            return JsonSerializer.Serialize(new { error = $"No data for sale {saleNo} of {year}. {hint} Valid dimensions: total, broker, elevation, grade, buyer, mark, priceRange." });
        }
        var table = MarkdownTable(rows.Select(s => (
            s.Label is not null && s.Label != s.Key ? $"{s.Key} \u2014 {s.Label}" : s.Key,
            s.Lots, s.SoldLots, Math.Round(s.SoldQtyKg, 0), Math.Round(s.ProceedsRs, 0),
            s.SoldQtyKg > 0 ? (decimal?)Math.Round(s.ProceedsRs / s.SoldQtyKg, 2) : null)),
            char.ToUpperInvariant(dim[0]) + dim[1..]);
        // markdownTable already carries every figure the model needs (and is what it's told to
        // paste verbatim), so no separate `rows` payload \u2014 that would just double this response's
        // token cost for data the model is instructed not to touch directly.
        return JsonSerializer.Serialize(new
        {
            scope = $"ALL brokers combined \u2014 sale {saleNo} of {year} \u2014 sorted by sold quantity",
            markdownTable = table,
        }, Json);
    }

    /// <summary>One broker's breakdown for a sale (e.g. ASC's buyers) — a direct capped
    /// aggregation over auctionLots, since the rollups aren't broker-crossed.</summary>
    private async Task<string> BrokerScopedBreakdown(int year, int saleNo, string dimension, string broker, int n, CancellationToken ct)
    {
        var (code, msl) = ResolveBroker(broker);
        if (msl is null)
            return JsonSerializer.Serialize(new { error = $"Unknown broker '{broker}'. Use ASC, BC, CT, EB, FW, JK, LC or MPB." });

        var field = dimension switch
        {
            "buyer" => "$bc", "grade" => "$g", "elevation" => "$el", "mark" => "$m", "total" => (MongoDB.Bson.BsonValue)MongoDB.Bson.BsonNull.Value,
            _ => null,
        };
        if (field is null)
            return JsonSerializer.Serialize(new { error = "With a broker, dimension must be one of: buyer, grade, elevation, mark, total." });

        var match = new MongoDB.Bson.BsonDocument { ["y"] = year, ["s"] = saleNo, ["b"] = msl };
        if (dimension == "buyer")
            match["bc"] = new MongoDB.Bson.BsonDocument("$ne", MongoDB.Bson.BsonNull.Value); // unsold lots have no buyer
        var pipeline = new[]
        {
            new MongoDB.Bson.BsonDocument("$match", match),
            new MongoDB.Bson.BsonDocument("$group", new MongoDB.Bson.BsonDocument
            {
                ["_id"] = field,
                ["label"] = new MongoDB.Bson.BsonDocument("$first", "$bn"),
                ["lots"] = new MongoDB.Bson.BsonDocument("$sum", 1),
                ["soldLots"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray { "$so", 1, 0 })),
                ["qty"] = new MongoDB.Bson.BsonDocument("$sum", "$q"),
                ["soldQty"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray { "$so", "$q", 0 })),
                ["value"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray
                    { "$so", new MongoDB.Bson.BsonDocument("$multiply", new MongoDB.Bson.BsonArray { "$q", "$p" }), 0 })),
            }),
            new MongoDB.Bson.BsonDocument("$sort", new MongoDB.Bson.BsonDocument("soldQty", -1)),
            new MongoDB.Bson.BsonDocument("$limit", n),
        };
        var docs = await db.AuctionLots.Aggregate<MongoDB.Bson.BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        if (docs.Count == 0)
        {
            var latest = await db.MslSaleStats
                .Find(s => s.Year == year && s.Dimension == "total")
                .SortByDescending(s => s.SaleNo).Limit(1).FirstOrDefaultAsync(ct);
            var hint = latest is null ? $"Year {year} has no data." : $"The latest available sale of {year} is sale {latest.SaleNo}.";
            return JsonSerializer.Serialize(new { error = $"No rows for broker {code} in sale {saleNo} of {year}. {hint}" });
        }
        var shaped = docs.Select(d =>
        {
            var soldQty = d["soldQty"].ToDecimal();
            var value = d["value"].ToDecimal();
            var name = d["_id"].IsBsonNull ? "(none)" : d["_id"].ToString()!;
            var label = dimension == "buyer" && !d["label"].IsBsonNull ? d["label"].AsString : null;
            return (Name: label ?? name,
                Lots: d["lots"].ToInt64(), SoldLots: d["soldLots"].ToInt64(),
                SoldQty: Math.Round(soldQty, 0), Proceeds: Math.Round(value, 0),
                Avg: soldQty > 0 ? (decimal?)Math.Round(value / soldQty, 2) : null,
                Key: name);
        }).ToList();
        var brokerName = Asc.Api.Modules.Msl.MslBrokers.CodeToName.GetValueOrDefault(msl, code);
        return JsonSerializer.Serialize(new
        {
            scope = $"{code} ({brokerName}) ONLY \u2014 sale {saleNo} of {year} \u2014 sorted by sold quantity",
            markdownTable = MarkdownTable(shaped.Select(s => (s.Name, s.Lots, s.SoldLots, s.SoldQty, s.Proceeds, s.Avg)),
                char.ToUpperInvariant(dimension[0]) + dimension[1..]),
        }, Json);
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
        var prefix = NormalizeMarkPrefix(mark);
        if (prefix is null)
            return JsonSerializer.Serialize(new { error = "The mark argument must be at least 2 characters." });
        var to = yearTo ?? DateTime.UtcNow.Year;
        var from = yearFrom ?? to - 3;
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

    private async Task<string> MarkBrokerHistory(string mark, int? yearFrom, int? yearTo, CancellationToken ct)
    {
        var normalized = NormalizeMarkPrefix(mark);
        if (normalized is null)
            return JsonSerializer.Serialize(new { error = "The mark argument must be at least 2 characters." });
        var to = yearTo ?? DateTime.UtcNow.Year;
        var from = yearFrom ?? to - 4;
        var prefix = System.Text.RegularExpressions.Regex.Escape(normalized);
        var pipeline = new[]
        {
            new MongoDB.Bson.BsonDocument("$match", new MongoDB.Bson.BsonDocument
            {
                ["m"] = new MongoDB.Bson.BsonRegularExpression("^" + prefix),
                ["y"] = new MongoDB.Bson.BsonDocument { ["$gte"] = from, ["$lte"] = to },
            }),
            new MongoDB.Bson.BsonDocument("$group", new MongoDB.Bson.BsonDocument
            {
                ["_id"] = new MongoDB.Bson.BsonDocument { ["y"] = "$y", ["s"] = "$s", ["b"] = "$b" },
                ["lots"] = new MongoDB.Bson.BsonDocument("$sum", 1),
                ["soldQty"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray { "$so", "$q", 0 })),
                ["value"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray
                    { "$so", new MongoDB.Bson.BsonDocument("$multiply", new MongoDB.Bson.BsonArray { "$q", "$p" }), 0 })),
            }),
            new MongoDB.Bson.BsonDocument("$sort", new MongoDB.Bson.BsonDocument { ["_id.y"] = 1, ["_id.s"] = 1 }),
        };
        var docs = await db.AuctionLots.Aggregate<MongoDB.Bson.BsonDocument>(pipeline, cancellationToken: ct).ToListAsync(ct);
        if (docs.Count == 0)
            return JsonSerializer.Serialize(new { error = $"No sales found for mark '{normalized}' in {from}-{to}." });

        string ShortCode(string? b) => b is null ? "?" :
            Asc.Api.Modules.Msl.MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => kv.Value == b).Key ?? b;

        var rows = docs.Select(d => (
            Y: d["_id"]["y"].ToInt32(), S: d["_id"]["s"].ToInt32(),
            B: d["_id"]["b"].IsBsonNull ? null : d["_id"]["b"].AsString,
            Lots: d["lots"].ToInt64(),
            SoldQty: d["soldQty"].ToDecimal(), Value: d["value"].ToDecimal())).ToList();

        // Per-broker period summary.
        var perBroker = rows.GroupBy(r => r.B).Select(g =>
        {
            var ordered = g.OrderBy(x => x.Y * 100 + x.S).ToList();
            var soldQty = g.Sum(x => x.SoldQty);
            var value = g.Sum(x => x.Value);
            return new
            {
                Broker = ShortCode(g.Key),
                FirstSale = $"{ordered[0].S:00}/{ordered[0].Y}",
                LastSale = $"{ordered[^1].S:00}/{ordered[^1].Y}",
                Sales = ordered.Count,
                Lots = g.Sum(x => x.Lots),
                SoldQty = Math.Round(soldQty, 0),
                Avg = soldQty > 0 ? (decimal?)Math.Round(value / soldQty, 2) : null,
                FirstIdx = ordered[0].Y * 100 + ordered[0].S,
                LastIdx = ordered[^1].Y * 100 + ordered[^1].S,
            };
        }).OrderBy(x => x.FirstIdx).ToList();

        // Transitions: broker A's activity ends, broker B's begins after it.
        var transitions = new List<object>();
        for (int i = 0; i + 1 < perBroker.Count; i++)
        {
            var a = perBroker[i];
            var b = perBroker[i + 1];
            if (a.LastIdx >= b.FirstIdx) continue; // overlapping = shared mark, not a switch
            var beforeSales = rows.Where(r => ShortCode(r.B) == a.Broker).OrderByDescending(r => r.Y * 100 + r.S).Take(6).ToList();
            var afterSales = rows.Where(r => ShortCode(r.B) == b.Broker).OrderBy(r => r.Y * 100 + r.S).Take(6).ToList();
            var bq = beforeSales.Sum(x => x.SoldQty); var bv = beforeSales.Sum(x => x.Value);
            var aq = afterSales.Sum(x => x.SoldQty); var av = afterSales.Sum(x => x.Value);
            decimal? avgBefore = bq > 0 ? Math.Round(bv / bq, 2) : null;
            decimal? avgAfter = aq > 0 ? Math.Round(av / aq, 2) : null;
            transitions.Add(new
            {
                fromBroker = a.Broker,
                toBroker = b.Broker,
                lastSaleWithOldBroker = a.LastSale,
                firstSaleWithNewBroker = b.FirstSale,
                avgBeforeSwitchRs = avgBefore, // weighted, old broker's final 6 sales
                avgAfterSwitchRs = avgAfter,   // weighted, new broker's first 6 sales
                changePct = avgBefore is > 0 && avgAfter is not null
                    ? Math.Round((avgAfter.Value - avgBefore.Value) / avgBefore.Value * 100, 1)
                    : (decimal?)null,
            });
        }

        var summaryTable = new System.Text.StringBuilder();
        summaryTable.AppendLine("| Broker | First sale | Last sale | Sales | Lots | Sold qty (kg) | Avg (Rs/kg) |");
        summaryTable.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");
        foreach (var s in perBroker)
            summaryTable.AppendLine($"| {s.Broker} | {s.FirstSale} | {s.LastSale} | {s.Sales} | {s.Lots:N0} | {s.SoldQty:N0} | {(s.Avg is null ? "-" : s.Avg.Value.ToString("N2"))} |");

        var recent = rows.OrderByDescending(r => r.Y * 100 + r.S).Take(40).OrderBy(r => r.Y * 100 + r.S).ToList();
        var perSaleTable = new System.Text.StringBuilder();
        perSaleTable.AppendLine("| Sale | Broker | Lots | Sold qty (kg) | Avg (Rs/kg) |");
        perSaleTable.AppendLine("| --- | --- | --- | --- | --- |");
        foreach (var r in recent)
        {
            var avg = r.SoldQty > 0 ? (r.Value / r.SoldQty).ToString("N2") : "-";
            perSaleTable.AppendLine($"| {r.S:00}/{r.Y} | {ShortCode(r.B)} | {r.Lots:N0} | {Math.Round(r.SoldQty, 0):N0} | {avg} |");
        }

        return JsonSerializer.Serialize(new
        {
            scope = $"Mark '{mark.Trim().ToUpperInvariant()}' \u2014 {from} to {to} \u2014 per broker",
            brokerSummaryTable = summaryTable.ToString().TrimEnd(),
            transitions,
            recentPerSaleTable = perSaleTable.ToString().TrimEnd(),
            note = rows.Count > 40 ? $"Per-sale table shows the most recent 40 of {rows.Count} sale-broker rows; the summary and transitions cover the full range." : null,
        }, Json);
    }

    /// <summary>Consultant-grade scanner: ranks marks by their premium vs the market average of
    /// the SAME sales they sold in, so tenures from different price eras compare fairly. When
    /// two tenures of the SAME mark are compared (recruit_leads / gained_improved), the mark's
    /// own grade/elevation profile travels with it, so product-mix bias largely cancels too.</summary>
    private async Task<string> ScanMarkPerformance(string mode, string? broker, int? yearFrom, int? yearTo, int minQtyKg, int n, CancellationToken ct)
    {
        mode = mode.Trim().ToLowerInvariant();
        if (mode is not ("recruit_leads" or "gained_improved" or "at_risk" or "top" or "bottom"))
            return JsonSerializer.Serialize(new { error = "mode must be recruit_leads, gained_improved, at_risk, top or bottom." });
        n = Math.Clamp(n, 1, 40);
        minQtyKg = Math.Max(minQtyKg, 1_000);
        var to = yearTo ?? DateTime.UtcNow.Year;
        var from = yearFrom ?? to - 5;

        string? code = null; string? msl = null;
        if (!string.IsNullOrWhiteSpace(broker))
        {
            (code, msl) = ResolveBroker(broker);
            if (msl is null)
                return JsonSerializer.Serialize(new { error = $"Unknown broker '{broker}'. Use ASC, BC, CT, EB, FW, JK, LC or MPB." });
        }
        if (msl is null && mode is "recruit_leads" or "gained_improved" or "at_risk")
            return JsonSerializer.Serialize(new { error = $"Mode '{mode}' needs a broker argument (e.g. ASC)." });

        // Stage 1: one pass over the range for every mark x broker tenure (totals + span).
        var saleIdx = new MongoDB.Bson.BsonDocument("$add", new MongoDB.Bson.BsonArray
            { new MongoDB.Bson.BsonDocument("$multiply", new MongoDB.Bson.BsonArray { "$y", 100 }), "$s" });
        var stage1 = new[]
        {
            new MongoDB.Bson.BsonDocument("$match", new MongoDB.Bson.BsonDocument
            {
                ["y"] = new MongoDB.Bson.BsonDocument { ["$gte"] = from, ["$lte"] = to },
                ["b"] = new MongoDB.Bson.BsonDocument("$ne", MongoDB.Bson.BsonNull.Value),
                ["m"] = new MongoDB.Bson.BsonDocument("$ne", MongoDB.Bson.BsonNull.Value),
            }),
            new MongoDB.Bson.BsonDocument("$group", new MongoDB.Bson.BsonDocument
            {
                ["_id"] = new MongoDB.Bson.BsonDocument { ["m"] = "$m", ["b"] = "$b" },
                ["soldQty"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray { "$so", "$q", 0 })),
                ["value"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray
                    { "$so", new MongoDB.Bson.BsonDocument("$multiply", new MongoDB.Bson.BsonArray { "$q", "$p" }), 0 })),
                ["firstIdx"] = new MongoDB.Bson.BsonDocument("$min", saleIdx),
                ["lastIdx"] = new MongoDB.Bson.BsonDocument("$max", saleIdx),
            }),
        };
        var tenureDocs = await db.AuctionLots
            .Aggregate<MongoDB.Bson.BsonDocument>(stage1, new AggregateOptions { AllowDiskUse = true }, ct)
            .ToListAsync(ct);

        string ShortCode(string b) =>
            Asc.Api.Modules.Msl.MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => kv.Value == b).Key ?? b;
        string SaleLabel(int idx) => $"{idx % 100:00}/{idx / 100}";

        var allTenures = tenureDocs.Select(d => (
                Mark: d["_id"]["m"].AsString.Trim(),
                B: d["_id"]["b"].AsString,
                SoldQty: d["soldQty"].ToDecimal(),
                Value: d["value"].ToDecimal(),
                FirstIdx: d["firstIdx"].ToInt32(),
                LastIdx: d["lastIdx"].ToInt32()))
            .Where(t => t.Mark.Length > 0)
            .ToList();
        var byMark = allTenures.GroupBy(t => t.Mark).ToDictionary(g => g.Key, g => g.ToList());

        // Current broker = the tenure a mark was most recently active with (any size).
        var currentBroker = byMark.ToDictionary(kv => kv.Key, kv => kv.Value.OrderByDescending(t => t.LastIdx).First().B);

        // Shortlist the marks that stage 2 (per-sale premium math) must cover.
        List<string> marks = mode switch
        {
            // recruit_leads and at_risk are the same candidate set — marks that had a real
            // tenure with this broker and have since moved on — just sorted and framed
            // oppositely (see below): win-back opportunities vs. an early-warning list.
            "recruit_leads" or "at_risk" => byMark
                .Where(kv => currentBroker[kv.Key] != msl
                    && kv.Value.Any(t => t.B == msl && t.SoldQty >= minQtyKg)
                    && kv.Value.Any(t => t.B == currentBroker[kv.Key] && t.SoldQty >= minQtyKg))
                .Select(kv => kv.Key).ToList(),
            "gained_improved" => byMark
                .Where(kv => currentBroker[kv.Key] == msl
                    && kv.Value.Any(t => t.B == msl && t.SoldQty >= minQtyKg)
                    && kv.Value.Any(t => t.B != msl && t.SoldQty >= minQtyKg))
                .Select(kv => kv.Key).ToList(),
            _ => allTenures
                .Where(t => t.SoldQty >= minQtyKg && (msl is null || t.B == msl))
                .OrderByDescending(t => t.SoldQty).Select(t => t.Mark).Distinct().Take(400).ToList(),
        };
        if (marks.Count == 0)
            return JsonSerializer.Serialize(new { error = $"No marks qualify for mode '{mode}' in {from}-{to} at minQtyKg {minQtyKg:N0}. Try a lower minQtyKg or a wider year range." });
        if (marks.Count > 400)
            marks = marks.OrderByDescending(m => byMark[m].Sum(t => t.SoldQty)).Take(400).ToList();

        // Stage 2: per-sale rows for just the shortlisted marks — the premium math needs the
        // mark's own quantity in each sale to weight the market reference honestly.
        var stage2 = new[]
        {
            new MongoDB.Bson.BsonDocument("$match", new MongoDB.Bson.BsonDocument
            {
                ["m"] = new MongoDB.Bson.BsonDocument("$in", new MongoDB.Bson.BsonArray(marks)),
                ["y"] = new MongoDB.Bson.BsonDocument { ["$gte"] = from, ["$lte"] = to },
                ["b"] = new MongoDB.Bson.BsonDocument("$ne", MongoDB.Bson.BsonNull.Value),
            }),
            new MongoDB.Bson.BsonDocument("$group", new MongoDB.Bson.BsonDocument
            {
                ["_id"] = new MongoDB.Bson.BsonDocument { ["m"] = "$m", ["b"] = "$b", ["y"] = "$y", ["s"] = "$s" },
                ["soldQty"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray { "$so", "$q", 0 })),
                ["value"] = new MongoDB.Bson.BsonDocument("$sum", new MongoDB.Bson.BsonDocument("$cond", new MongoDB.Bson.BsonArray
                    { "$so", new MongoDB.Bson.BsonDocument("$multiply", new MongoDB.Bson.BsonArray { "$q", "$p" }), 0 })),
            }),
        };
        var saleDocs = await db.AuctionLots
            .Aggregate<MongoDB.Bson.BsonDocument>(stage2, new AggregateOptions { AllowDiskUse = true }, ct)
            .ToListAsync(ct);
        var perSale = saleDocs.Select(d => (
                Mark: d["_id"]["m"].AsString.Trim(),
                B: d["_id"]["b"].AsString,
                Idx: d["_id"]["y"].ToInt32() * 100 + d["_id"]["s"].ToInt32(),
                SoldQty: d["soldQty"].ToDecimal(),
                Value: d["value"].ToDecimal()))
            .ToLookup(r => (r.Mark, r.B));

        // Market reference: the whole market's weighted average per sale, from the rollups.
        var totals = await db.MslSaleStats
            .Find(s => s.Dimension == "total" && s.Year >= from && s.Year <= to)
            .ToListAsync(ct);
        var market = totals.Where(t => t.SoldQtyKg > 0)
            .ToDictionary(t => t.Year * 100 + t.SaleNo, t => t.ProceedsRs / t.SoldQtyKg);

        // A tenure's premium: mark avg vs the market avg of the SAME sales, weighted by the
        // mark's own sold quantity in each — the era-neutral performance measure.
        (decimal Avg, decimal RefAvg, decimal Premium)? Tenure(string mark, string b)
        {
            decimal q = 0, v = 0, rv = 0;
            foreach (var r in perSale[(mark, b)])
                if (r.SoldQty > 0 && market.TryGetValue(r.Idx, out var mkt))
                {
                    q += r.SoldQty; v += r.Value; rv += r.SoldQty * mkt;
                }
            if (q <= 0 || rv <= 0) return null;
            var avg = v / q; var refAvg = rv / q;
            return (Math.Round(avg, 2), Math.Round(refAvg, 2), Math.Round((avg - refAvg) / refAvg * 100, 1));
        }

        var sb = new System.Text.StringBuilder();
        string scope;
        if (mode is "recruit_leads" or "gained_improved" or "at_risk")
        {
            // recruit_leads and at_risk share the "left this broker" candidate set (built
            // above) and only differ in sort direction and framing; gained_improved is the
            // mirror-image candidate set (marks that joined and stayed).
            var recruiting = mode is "recruit_leads" or "at_risk";
            var leads = marks.Select(mark =>
            {
                var other = recruiting
                    ? currentBroker[mark]
                    : byMark[mark].Where(t => t.B != msl && t.SoldQty >= minQtyKg).OrderByDescending(t => t.LastIdx).First().B;
                var mine = Tenure(mark, msl!);
                var theirs = Tenure(mark, other);
                if (mine is null || theirs is null) return null;
                var myTenure = byMark[mark].First(t => t.B == msl);
                return new
                {
                    Mark = mark,
                    OtherBroker = ShortCode(other),
                    TheirPremium = theirs.Value.Premium,
                    MySpan = $"{SaleLabel(myTenure.FirstIdx)}-{SaleLabel(myTenure.LastIdx)}",
                    MyPremium = mine.Value.Premium,
                    EdgePp = Math.Round(mine.Value.Premium - theirs.Value.Premium, 1),
                    MyQty = Math.Round(myTenure.SoldQty, 0),
                };
            }).Where(x => x is not null).Select(x => x!)
              .OrderBy(x => mode == "at_risk" ? x.EdgePp : -x.EdgePp) // at_risk: worst edge first (biggest warning); the other two: best edge first
              .Take(n).ToList();

            if (leads.Count == 0)
                return JsonSerializer.Serialize(new { error = $"No qualifying marks for mode '{mode}' with broker {code} in {from}-{to}. Try a wider year range or lower minQtyKg." });

            var otherHeader = mode == "gained_improved" ? "Previous broker" : "Now with";
            var edgeHeader = mode switch
            {
                "recruit_leads" => $"Edge for {code} (pp)",
                "at_risk" => $"Gap vs current broker (pp)",
                _ => "Gain since joining (pp)",
            };
            sb.AppendLine($"| # | Mark | {otherHeader} | Their premium vs market | {code} tenure | {code} premium vs market | {edgeHeader} | Sold kg with {code} |");
            sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- | --- |");
            var i = 1;
            foreach (var l in leads)
                sb.AppendLine($"| {i++} | {l.Mark} | {l.OtherBroker} | {l.TheirPremium:+0.0;-0.0}% | {l.MySpan} | {l.MyPremium:+0.0;-0.0}% | {l.EdgePp:+0.0;-0.0} | {l.MyQty:N0} |");
            scope = mode switch
            {
                "recruit_leads" => $"Marks now with OTHER brokers that performed better during a past {code} tenure — {from} to {to} — min {minQtyKg:N0} kg per tenure — sorted by {code}'s premium edge, best first",
                "at_risk" => $"Marks that LEFT {code} and are now performing notably better elsewhere — {from} to {to} — min {minQtyKg:N0} kg per tenure — sorted worst gap first (early-warning / root-cause list, not a pitch list)",
                _ => $"Marks now with {code} vs their previous broker — {from} to {to} — min {minQtyKg:N0} kg per tenure — sorted by improvement",
            };
        }
        else
        {
            var markSet = marks.ToHashSet();
            var ranked = allTenures
                .Where(t => markSet.Contains(t.Mark) && t.SoldQty >= minQtyKg && (msl is null || t.B == msl))
                .Select(t => new { t.Mark, t.B, Stats = Tenure(t.Mark, t.B), Qty = Math.Round(t.SoldQty, 0) })
                .Where(x => x.Stats is not null)
                .OrderByDescending(x => mode == "top" ? x.Stats!.Value.Premium : -x.Stats!.Value.Premium)
                .Take(n).ToList();

            sb.AppendLine("| # | Mark | Broker | Sold qty (kg) | Avg (Rs/kg) | Market ref (Rs/kg) | Premium vs market |");
            sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");
            var i = 1;
            foreach (var r in ranked)
                sb.AppendLine($"| {i++} | {r.Mark} | {ShortCode(r.B)} | {r.Qty:N0} | {r.Stats!.Value.Avg:N2} | {r.Stats.Value.RefAvg:N2} | {r.Stats.Value.Premium:+0.0;-0.0}% |");
            scope = $"{(mode == "top" ? "Best" : "Worst")} market-relative performers{(code is null ? "" : $" within {code}")} — {from} to {to} — min {minQtyKg:N0} kg — scanned the {marks.Count} largest qualifying marks";
        }

        return JsonSerializer.Serialize(new
        {
            scope,
            markdownTable = sb.ToString().TrimEnd(),
            methodology = "Premium % = the mark's quantity-weighted average vs the overall market " +
                "average of the SAME sales it sold in, so tenures from different price eras compare " +
                "fairly. Comparing the same mark across two brokers also cancels most product-mix " +
                "effects. Treat it as evidence, not proof — leaf standard, invoicing and season " +
                "also move prices.",
        }, Json);
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
