using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Asc.Api.Data;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Msl.FactoryAverages;
using MongoDB.Driver;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// The Analytics Agent's window onto the monthly Factory Wise Averages reports (every factory's
/// quantity and average price by elevation, main vs off grade, monthly and year-to-date, with rank —
/// Jan 2023 onward, all brokers). Two tools: a month's factory table, and one factory's history.
/// Read-only; every answer carries a scope line and a pre-formatted markdown table so the model pastes
/// figures instead of retyping them.
/// </summary>
public class FactoryAverageTools(MongoContext db, ILogger<FactoryAverageTools> logger)
{
    public const string TableTool = "get_factory_averages";
    public const string HistoryTool = "factory_history";

    public static bool IsFactoryTool(string name) => name is TableTool or HistoryTool;

    private const int MaxRows = 40;
    private const int MaxHistoryMonths = 48;

    /// <summary>Below this monthly volume a factory's average price is too noisy to rank by price.</summary>
    private const int DefaultMinQtyKgForPrice = 10_000;

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        new(TableTool,
            "Factory-level results for ONE month from the monthly Factory Wise Averages reports (all brokers' Colombo " +
            "sales, January 2023 onward): each factory's total quantity (kg), average price (Rs/kg), main-grade and " +
            "off-grade quantity and price, and its rank within its elevation. Use it for 'top factories', 'which " +
            "factory got the best price', 'how did estate X do in <month>'. Filter by elevation (UVA HIGH, WESTERN HIGH, " +
            "UVA MEDIUM, WESTERN MEDIUM, LOW — or HIGH / MEDIUM to cover both regions) and/or a factory name or MF code. " +
            "Sorted by quantity unless sortBy says otherwise; when sorting by price, factories under minQtyKg are " +
            "excluded so a tiny lot cannot top the list. Returns a markdownTable to paste verbatim, plus the elevation " +
            "and month totals.",
            new
            {
                type = "object",
                properties = new
                {
                    year = new { type = "string", description = "Report year. Omit (with month) for the latest month available." },
                    month = new { type = "string", description = "1-12. Omit (with year) for the latest month available." },
                    elevation = new { type = "string", description = "UVA HIGH | WESTERN HIGH | UVA MEDIUM | WESTERN MEDIUM | LOW | HIGH | MEDIUM. Omit for all elevations." },
                    factory = new { type = "string", description = "Factory/estate name (contains, case-insensitive) or MF code such as MF0581." },
                    sortBy = new { type = "string", description = "quantity (default) | price | rank" },
                    n = new { type = "string", description = "Rows to return. Default 15, max 40." },
                    minQtyKg = new { type = "string", description = "Minimum total monthly kg to include when sortBy=price. Default 10000." },
                },
            }),
        new(HistoryTool,
            "One factory's month-by-month history from the Factory Wise Averages reports (January 2023 onward): " +
            "quantity, average price (total, main grade, off grade) and elevation rank each month, oldest first. " +
            "Use it for 'how has estate X's price moved', 'is factory Y improving'. Identify the factory by MF code " +
            "(e.g. MF0581) or name; if a name matches several factories the tool lists them so you can ask which.",
            new
            {
                type = "object",
                properties = new
                {
                    factory = new { type = "string", description = "MF code (MF0581) or factory/estate name." },
                    yearFrom = new { type = "string", description = "First year to include. Default: about 2 years back." },
                    yearTo = new { type = "string", description = "Last year to include. Default: latest available." },
                },
                required = new[] { "factory" },
            }),
    ];

    private static readonly Dictionary<string, string[]> ElevationAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["UVA HIGH"] = ["UVA HIGH"],
        ["WESTERN HIGH"] = ["WESTERN HIGH"],
        ["UVA MEDIUM"] = ["UVA MEDIUM"],
        ["WESTERN MEDIUM"] = ["WESTERN MEDIUM"],
        ["LOW"] = ["LOW"],
        ["LOW GROWN"] = ["LOW"],
        ["HIGH"] = ["UVA HIGH", "WESTERN HIGH"],
        ["HIGH GROWN"] = ["UVA HIGH", "WESTERN HIGH"],
        ["MEDIUM"] = ["UVA MEDIUM", "WESTERN MEDIUM"],
        ["MEDIUM GROWN"] = ["UVA MEDIUM", "WESTERN MEDIUM"],
    };

    public async Task<string> ExecuteAsync(string name, string argumentsJson, CancellationToken ct = default)
    {
        logger.LogInformation("Factory average tool call: {Tool} args={Args}", name, argumentsJson);
        try
        {
            var args = AssistantToolExecutor.ParseArgs(argumentsJson);
            return name switch
            {
                TableTool => await FactoryTable(args, ct),
                HistoryTool => await FactoryHistory(args, ct),
                _ => Error($"Unknown tool '{name}'."),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Factory average tool failed: {Tool} args={Args}", name, argumentsJson);
            return Error($"Tool '{name}' failed: {ex.Message}");
        }
    }

    // ---- month table ----

    private async Task<string> FactoryTable(JsonObject args, CancellationToken ct)
    {
        var (year, month) = (Int(args, "year"), Int(args, "month"));
        if ((year is null) != (month is null)) return Error("Give both year and month, or neither for the latest month available.");
        if (year is null)
        {
            var latest = await LatestMonth(ct);
            if (latest is null) return Error("No factory averages have been imported yet.");
            (year, month) = (latest.Value.Year, latest.Value.Month);
        }

        string[]? elevations = null;
        if (Str(args, "elevation") is { } e)
        {
            if (!ElevationAliases.TryGetValue(e.Replace('-', ' ').Trim(), out elevations))
                return Error($"Unknown elevation '{e}'. Use UVA HIGH, WESTERN HIGH, UVA MEDIUM, WESTERN MEDIUM, LOW, HIGH or MEDIUM.");
        }

        var rows = await db.FactoryAverages
            .Find(f => f.Year == year && f.Month == month && f.RowType == FactoryAverageRowType.Factory)
            .ToListAsync(ct);
        if (rows.Count == 0) return Error($"No factory averages for {Label(year.Value, month!.Value)}. Reports are held from January 2023; use get_factory_averages without a month for the latest.");

        var totals = await db.FactoryAverages
            .Find(f => f.Year == year && f.Month == month && f.RowType != FactoryAverageRowType.Factory)
            .ToListAsync(ct);

        var query = rows.AsEnumerable();
        if (elevations is not null) query = query.Where(r => elevations.Contains(r.Elevation!, StringComparer.Ordinal));
        var factoryArg = Str(args, "factory");
        if (factoryArg is not null)
            query = query.Where(r => string.Equals(r.MfCode, factoryArg, StringComparison.OrdinalIgnoreCase) ||
                                     (r.FactoryName ?? "").Contains(factoryArg, StringComparison.OrdinalIgnoreCase));
        var matched = query.ToList();
        if (matched.Count == 0) return Error($"No factory matching those filters in {Label(year.Value, month!.Value)}.");

        var sortBy = (Str(args, "sortBy") ?? "quantity").ToLowerInvariant();
        var minQty = Int(args, "minQtyKg") ?? DefaultMinQtyKgForPrice;
        var n = Math.Clamp(Int(args, "n") ?? 15, 1, MaxRows);
        string sortNote;
        switch (sortBy)
        {
            case "price":
                matched = matched.Where(r => (r.TotalMonthlyQtyKg ?? 0) >= minQty && r.TotalMonthlyAvgRs is not null)
                    .OrderByDescending(r => r.TotalMonthlyAvgRs).ToList();
                sortNote = $"highest average price first, factories with at least {minQty:N0} kg only";
                break;
            case "rank":
                matched = matched.OrderBy(r => r.MonthlyRank ?? int.MaxValue).ThenBy(r => r.Elevation, StringComparer.Ordinal).ToList();
                sortNote = "by rank within elevation";
                break;
            default:
                matched = matched.OrderByDescending(r => r.TotalMonthlyQtyKg ?? 0).ToList();
                sortNote = "largest quantity first";
                break;
        }
        if (matched.Count == 0) return Error($"No factory reached {minQty:N0} kg in that selection — lower minQtyKg.");
        var shown = matched.Take(n).ToList();

        var scope = $"Factory Wise Averages, {Label(year.Value, month!.Value)} · all brokers · " +
                    $"{(elevations is null ? "all elevations" : string.Join(" + ", elevations))}" +
                    $"{(factoryArg is null ? "" : $" · '{factoryArg}'")} · {shown.Count} of {matched.Count} factories, {sortNote}";

        return JsonSerializer.Serialize(new
        {
            scope,
            year,
            month,
            markdownTable = FactoryMarkdown(shown),
            totals = TotalsMarkdown(totals, elevations),
            note = "Prices are Rs/kg (quantity-weighted); ranks are within each elevation by total monthly quantity. Figures are 'total' = main grade + off grade.",
        });
    }

    private static string FactoryMarkdown(IEnumerable<FactoryAverage> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine("| Factory | MF code | Elevation | Rank | Total kg | Total Rs/kg | Main kg | Main Rs/kg | Off kg | Off Rs/kg |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
        foreach (var r in rows)
            sb.AppendLine($"| {r.FactoryName} | {r.MfCode} | {r.Elevation} | {r.MonthlyRank?.ToString(CultureInfo.InvariantCulture) ?? "-"} | " +
                          $"{Kg(r.TotalMonthlyQtyKg)} | {Rs(r.TotalMonthlyAvgRs)} | {Kg(r.MainMonthlyQtyKg)} | {Rs(r.MainMonthlyAvgRs)} | {Kg(r.OffMonthlyQtyKg)} | {Rs(r.OffMonthlyAvgRs)} |");
        return sb.ToString().TrimEnd();
    }

    private static string TotalsMarkdown(List<FactoryAverage> totals, string[]? elevations)
    {
        var sb = new StringBuilder();
        sb.AppendLine("| Scope | Total kg | Total Rs/kg | Main Rs/kg | Off Rs/kg |");
        sb.AppendLine("| --- | --- | --- | --- | --- |");
        foreach (var t in totals.Where(t => t.RowType == FactoryAverageRowType.ElevationTotal && (elevations is null || elevations.Contains(t.Elevation!, StringComparer.Ordinal)))
                     .OrderBy(t => Array.IndexOf(["UVA HIGH", "WESTERN HIGH", "UVA MEDIUM", "WESTERN MEDIUM", "LOW"], t.Elevation)))
            sb.AppendLine($"| {t.Elevation} (all factories) | {Kg(t.TotalMonthlyQtyKg)} | {Rs(t.TotalMonthlyAvgRs)} | {Rs(t.MainMonthlyAvgRs)} | {Rs(t.OffMonthlyAvgRs)} |");
        if (elevations is null && totals.FirstOrDefault(t => t.RowType == FactoryAverageRowType.GrandTotal) is { } g)
            sb.AppendLine($"| ALL ELEVATIONS | {Kg(g.TotalMonthlyQtyKg)} | {Rs(g.TotalMonthlyAvgRs)} | {Rs(g.MainMonthlyAvgRs)} | {Rs(g.OffMonthlyAvgRs)} |");
        return sb.ToString().TrimEnd();
    }

    // ---- one factory's history ----

    private async Task<string> FactoryHistory(JsonObject args, CancellationToken ct)
    {
        var factory = Str(args, "factory");
        if (factory is null || factory.Length < 3) return Error("Give the factory's MF code (e.g. MF0581) or at least 3 letters of its name.");

        string code;
        var looksLikeCode = System.Text.RegularExpressions.Regex.IsMatch(factory.Replace(" ", ""), @"^[A-Za-z]{2,3}\d{3,5}$");
        if (looksLikeCode)
        {
            code = factory.Replace(" ", "").ToUpperInvariant();
        }
        else
        {
            var matches = await db.FactoryAverages
                .Find(Builders<FactoryAverage>.Filter.Eq(f => f.RowType, FactoryAverageRowType.Factory) &
                      Builders<FactoryAverage>.Filter.Regex(f => f.FactoryName,
                          new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(factory), "i")))
                .SortByDescending(f => f.Year).ThenByDescending(f => f.Month)
                .Limit(400).ToListAsync(ct);
            var codes = matches.GroupBy(m => m.MfCode!).Select(g => (Code: g.Key, g.First().FactoryName, g.First().Elevation)).ToList();
            if (codes.Count == 0) return Error($"No factory named like '{factory}' in the Factory Wise Averages.");
            if (codes.Count > 1)
                return JsonSerializer.Serialize(new
                {
                    ambiguous = true,
                    message = $"'{factory}' matches {codes.Count} factories — ask the user which one, then call again with its MF code.",
                    candidates = codes.Take(12).Select(c => $"{c.FactoryName} ({c.Code}, {c.Elevation})"),
                });
            code = codes[0].Code;
        }

        var latest = await LatestMonth(ct);
        if (latest is null) return Error("No factory averages have been imported yet.");
        var yearTo = Int(args, "yearTo") ?? latest.Value.Year;
        var yearFrom = Int(args, "yearFrom") ?? Math.Max(2019, yearTo - 2);

        var rows = await db.FactoryAverages
            .Find(f => f.MfCode == code && f.RowType == FactoryAverageRowType.Factory && f.Year >= yearFrom && f.Year <= yearTo)
            .SortBy(f => f.Year).ThenBy(f => f.Month).ToListAsync(ct);
        if (rows.Count == 0) return Error($"No factory averages for {code} between {yearFrom} and {yearTo}.");
        if (rows.Count > MaxHistoryMonths) rows = rows.Skip(rows.Count - MaxHistoryMonths).ToList();

        var sb = new StringBuilder();
        sb.AppendLine("| Month | Elevation | Rank | Total kg | Total Rs/kg | Main Rs/kg | Off Rs/kg |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");
        foreach (var r in rows)
            sb.AppendLine($"| {Label(r.Year, r.Month)} | {r.Elevation} | {r.MonthlyRank?.ToString(CultureInfo.InvariantCulture) ?? "-"} | {Kg(r.TotalMonthlyQtyKg)} | {Rs(r.TotalMonthlyAvgRs)} | {Rs(r.MainMonthlyAvgRs)} | {Rs(r.OffMonthlyAvgRs)} |");

        var priced = rows.Where(r => r.TotalMonthlyAvgRs is not null && (r.TotalMonthlyQtyKg ?? 0) > 0).ToList();
        object? summary = null;
        if (priced.Count >= 2)
        {
            var (first, last) = (priced[0], priced[^1]);
            var best = priced.MaxBy(r => r.TotalMonthlyAvgRs)!;
            summary = new
            {
                first = $"{Label(first.Year, first.Month)}: Rs {Rs(first.TotalMonthlyAvgRs)}/kg",
                last = $"{Label(last.Year, last.Month)}: Rs {Rs(last.TotalMonthlyAvgRs)}/kg",
                changePct = first.TotalMonthlyAvgRs > 0 ? Math.Round((last.TotalMonthlyAvgRs!.Value - first.TotalMonthlyAvgRs!.Value) / first.TotalMonthlyAvgRs.Value * 100, 1) : (decimal?)null,
                bestMonth = $"{Label(best.Year, best.Month)}: Rs {Rs(best.TotalMonthlyAvgRs)}/kg",
            };
        }

        return JsonSerializer.Serialize(new
        {
            scope = $"Factory Wise Averages · {rows[0].FactoryName} ({code}) · {Label(rows[0].Year, rows[0].Month)} to {Label(rows[^1].Year, rows[^1].Month)} · all brokers",
            markdownTable = sb.ToString().TrimEnd(),
            summary,
            note = "Prices are Rs/kg (quantity-weighted); a month with little volume can swing widely. Rank is within the factory's elevation.",
        });
    }

    // ---- helpers ----

    private async Task<(int Year, int Month)?> LatestMonth(CancellationToken ct)
    {
        var g = await db.FactoryAverages.Find(f => f.RowType == FactoryAverageRowType.GrandTotal)
            .SortByDescending(f => f.Year).ThenByDescending(f => f.Month).Limit(1).FirstOrDefaultAsync(ct);
        return g is null ? null : (g.Year, g.Month);
    }

    private static string Error(string message) => JsonSerializer.Serialize(new { error = message });

    private static string Label(int year, int month) =>
        $"{CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(month)} {year}";

    private static string Kg(decimal? v) => v is null ? "-" : v.Value.ToString("N0", CultureInfo.InvariantCulture);
    private static string Rs(decimal? v) => v is null ? "-" : v.Value.ToString("N2", CultureInfo.InvariantCulture);

    private static string? Str(JsonObject args, string key) =>
        args[key] is { } n && n.GetValueKind() == JsonValueKind.String && n.GetValue<string>().Trim() is { Length: > 0 } s ? s : null;

    /// <summary>Numbers arrive as JSON numbers or strings depending on the model — accept both.</summary>
    private static int? Int(JsonObject args, string key)
    {
        if (args[key] is not { } n) return null;
        return n.GetValueKind() switch
        {
            JsonValueKind.String => int.TryParse(n.GetValue<string>(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null,
            JsonValueKind.Number => n.GetValue<double>() is var d && d == Math.Floor(d) ? (int)d : null,
            _ => null,
        };
    }
}
