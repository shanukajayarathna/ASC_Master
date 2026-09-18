using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Msl;
using Microsoft.Extensions.Caching.Memory;

namespace Asc.Api.Modules.Agents;

public record CustomSeries(string Name, IReadOnlyList<decimal?> Values);

/// <summary>One query_data result, held server-side so make_chart can draw it without the model
/// ever re-typing (and possibly corrupting) the numbers.</summary>
public record CustomDataset(
    string Id, string Title, string Scope, string Metric, string Unit, bool Additive,
    string CategoryAxis, IReadOnlyList<string> Categories, IReadOnlyList<CustomSeries> Series);

/// <summary>
/// Pure logic behind the Reports Agent's custom-report tools — argument validation, dataset
/// shaping, markdown and chart-spec building. No I/O, so it is unit-tested directly (project
/// convention: never instantiate MongoContext in tests).
/// </summary>
public static class CustomReportLogic
{
    public const int MaxCategories = 12;
    public const int MaxSales = 12;
    public const int DefaultSales = 6;

    public sealed record MetricDef(string Key, string Label, string Unit, bool Additive, Func<FilteredSectionRow, decimal?> Value);

    public static readonly IReadOnlyDictionary<string, MetricDef> Metrics = new Dictionary<string, MetricDef>(StringComparer.OrdinalIgnoreCase)
    {
        ["quantity_kg"] = new("quantity_kg", "Quantity offered (kg)", "kg", true, r => r.TotalQtyKg),
        ["sold_quantity_kg"] = new("sold_quantity_kg", "Quantity sold (kg)", "kg", true, r => r.SoldQtyKg),
        ["proceeds_rs"] = new("proceeds_rs", "Proceeds (Rs)", "Rs", true, r => r.ProceedsRs),
        ["avg_price_rs"] = new("avg_price_rs", "Average price (Rs/kg)", "Rs/kg", false, r => r.AvgPriceRs),
        ["lots"] = new("lots", "Lots offered", "lots", true, r => r.Lots),
        ["sold_lots"] = new("sold_lots", "Lots sold", "lots", true, r => r.SoldLots),
    };

    public static readonly IReadOnlyList<string> Dimensions =
        ["broker", "elevation", "grade", "category", "buyer", "mark", "factory", "price_range", "sale", "sold_status"];

    public static readonly IReadOnlyList<string> ChartTypes =
        ["bar", "horizontal_bar", "stacked_bar", "percent_stacked_bar", "line", "pie"];

    public static IReadOnlyList<FilteredSectionRow>? Section(FilteredAnalyticsDto d, string dimension) => dimension switch
    {
        "broker" => d.ByBroker,
        "elevation" => d.ByElevation,
        "grade" => d.ByGrade,
        "category" => d.ByCategory,
        "buyer" => d.ByBuyer,
        "mark" => d.ByMark,
        "factory" => d.ByFactory,
        "price_range" => d.ByPriceRange,
        "sale" => d.BySale,
        "sold_status" => d.ByOkloStatus,
        _ => null,
    };

    /// <summary>Broker short code users know (ASC, BC, CT…) for an MSL code (AS, BTL, DES…).</summary>
    public static string BrokerDisplay(string mslCode) =>
        MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => string.Equals(kv.Value, mslCode, StringComparison.OrdinalIgnoreCase)).Key ?? mslCode;

    public static string DisplayName(string dimension, FilteredSectionRow row) => dimension switch
    {
        "broker" => BrokerDisplay(row.Key),
        "elevation" or "buyer" => row.Label ?? row.Key,
        _ => row.Key,
    };

    // ---------------------------------------------------------------- filter parsing

    private static List<string>? Strings(JsonNode? node)
    {
        if (node is null) return null;
        if (node is JsonArray arr) return arr.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToList();
        var single = node.ToString();
        return single.Length > 0 ? [single] : null;
    }

    private static List<int>? Ints(JsonNode? node) =>
        Strings(node)?.Select(s => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : (int?)null)
            .Where(n => n is not null).Select(n => n!.Value).ToList();

    private static string? Canonical(string value, IEnumerable<string> valid)
    {
        static string Norm(string s) => new string(s.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        var n = Norm(value);
        return valid.FirstOrDefault(v => Norm(v) == n);
    }

    /// <summary>Validates every filter argument against the archive's real values, returning a
    /// message listing the valid ones on a miss — small models recover from that in one retry.</summary>
    public static bool TryParseFilter(JsonNode args, FilterOptionsDto options, out MslAnalyticsFilter filter, out string? error)
    {
        filter = new MslAnalyticsFilter(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null, null);
        error = null;
        string? err = null;

        List<string>? Resolve(string arg, IReadOnlyList<string> valid)
        {
            var given = Strings(args[arg]);
            if (given is null) return null;
            var mapped = new List<string>();
            foreach (var g in given)
            {
                var c = Canonical(g, valid);
                if (c is null) { err = $"Unknown {arg} value '{g}'. Valid values: {string.Join(", ", valid)}."; return null; }
                mapped.Add(c);
            }
            return mapped;
        }

        var categories = Resolve("categories", options.Categories);
        if (err is not null) { error = err; return false; }
        var gradeTypes = Resolve("grade_types", options.GradeTypes);
        if (err is not null) { error = err; return false; }
        var teaTypes = Resolve("tea_types", options.TeaTypes);
        if (err is not null) { error = err; return false; }
        var manufactures = Resolve("manufactures", options.Manufactures);
        if (err is not null) { error = err; return false; }
        var elevations = Resolve("elevations", [.. MslBrokers.ElevationNames.Values]);
        if (err is not null) { error = err; return false; }

        List<string>? brokers = null;
        var givenBrokers = Strings(args["brokers"]);
        if (givenBrokers is not null)
        {
            brokers = [];
            foreach (var b in givenBrokers)
            {
                var code = b.Trim().ToUpperInvariant();
                if (MslBrokers.ExcelCodeToMslCode.TryGetValue(code, out var mapped)) brokers.Add(mapped);
                else if (MslBrokers.CodeToName.ContainsKey(code)) brokers.Add(code);
                else { error = $"Unknown broker '{b}'. Use ASC, BC, CT, EB, FW, JK, LC or MPB."; return false; }
            }
        }

        List<string>? grades = null;
        var givenGrades = Strings(args["grades"]);
        if (givenGrades is not null)
        {
            grades = [];
            foreach (var g in givenGrades)
            {
                var c = Canonical(g, options.Grades);
                if (c is null) { error = $"Unknown grade '{g}'."; return false; }
                grades.Add(c);
            }
        }

        var soldStatus = args["sold_status"]?.ToString().Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(soldStatus) && soldStatus is not ("sold" or "unsold"))
        { error = "sold_status must be 'sold' or 'unsold'."; return false; }
        var saleType = args["sale_type"]?.ToString().Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(saleType) && saleType is not ("public" or "private"))
        { error = "sale_type must be 'public' or 'private'."; return false; }

        filter = filter with
        {
            Years = Ints(args["years"]),
            SaleNos = Ints(args["sale_nos"]),
            Brokers = brokers,
            Categories = categories,
            GradeTypes = gradeTypes,
            TeaTypes = teaTypes,
            Manufactures = manufactures,
            Elevations = elevations,
            Grades = grades,
            SoldStatus = string.IsNullOrEmpty(soldStatus) ? null : soldStatus,
            SaleType = string.IsNullOrEmpty(saleType) ? null : saleType,
        };
        return true;
    }

    /// <summary>Human-readable summary of the filter so the report always states its own scope.</summary>
    public static string DescribeFilter(MslAnalyticsFilter f)
    {
        var parts = new List<string>();
        void Add(string label, IEnumerable<string>? v) { if (v is not null && v.Any()) parts.Add($"{label}: {string.Join("/", v)}"); }
        Add("category", f.Categories);
        Add("grade type", f.GradeTypes);
        Add("tea type", f.TeaTypes);
        Add("manufacture", f.Manufactures);
        Add("elevation", f.Elevations);
        Add("grade", f.Grades);
        Add("broker", f.Brokers?.Select(BrokerDisplay));
        if (f.SoldStatus is not null) parts.Add(f.SoldStatus);
        if (f.SaleType is not null) parts.Add($"{f.SaleType} sales");
        return parts.Count == 0 ? "all teas" : string.Join(", ", parts);
    }

    // ---------------------------------------------------------------- dataset shaping

    /// <summary>
    /// Builds a dataset from one aggregation result per column. Without a split there is one
    /// column and the categories are the group rows; with a split (per sale) the columns become
    /// the categories and each group row becomes a series. Only the top rows are kept; for
    /// additive metrics the remainder is folded into "Other" so shares still add up to 100%.
    /// </summary>
    public static CustomDataset BuildDataset(
        string id, string title, string scope, string dimension, MetricDef metric, bool split,
        IReadOnlyList<(string Label, IReadOnlyList<FilteredSectionRow> Rows)> columns, int topN)
    {
        topN = Math.Clamp(topN, 1, MaxCategories);
        var display = new Dictionary<string, string>();
        var rank = new Dictionary<string, decimal>();
        var cell = new Dictionary<(string Key, int Col), decimal?>();

        for (var i = 0; i < columns.Count; i++)
            foreach (var row in columns[i].Rows)
            {
                display.TryAdd(row.Key, DisplayName(dimension, row));
                var v = metric.Value(row);
                cell[(row.Key, i)] = v;
                rank[row.Key] = rank.GetValueOrDefault(row.Key) + (metric.Additive ? v ?? 0 : row.TotalQtyKg);
            }

        var ordered = rank.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
        // A time axis reads left to right; sales are already chronological columns, but a "sale"
        // dimension without a split keeps its natural order rather than being ranked by volume.
        if (dimension == "sale" && !split) ordered = ordered.OrderBy(k => k, StringComparer.Ordinal).ToList();
        var kept = ordered.Take(topN).ToList();
        var rest = ordered.Skip(topN).ToList();
        var showOther = metric.Additive && rest.Count > 0;

        decimal? ValueOf(string key, int col) => cell.GetValueOrDefault((key, col));
        decimal? OtherAt(int col) => rest.Sum(k => ValueOf(k, col) ?? 0);

        var rows = kept.Select(k => (Name: display[k], Values: Enumerable.Range(0, columns.Count).Select(c => ValueOf(k, c)).ToList())).ToList();
        if (showOther) rows.Add(("Other", Enumerable.Range(0, columns.Count).Select(OtherAt).ToList()));

        if (!split)
        {
            return new CustomDataset(id, title, scope, metric.Label, metric.Unit, metric.Additive, ToTitle(dimension),
                rows.Select(r => r.Name).ToList(), [new CustomSeries(metric.Label, rows.Select(r => r.Values[0]).ToList())]);
        }

        return new CustomDataset(id, title, scope, metric.Label, metric.Unit, metric.Additive, "Sale",
            columns.Select(c => c.Label).ToList(), rows.Select(r => new CustomSeries(r.Name, r.Values)).ToList());
    }

    private static string ToTitle(string dimension) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(dimension.Replace('_', ' '));

    private static string Fmt(decimal? v, string unit) =>
        v is null ? "–" : unit == "Rs/kg" ? v.Value.ToString("N2", CultureInfo.InvariantCulture) : v.Value.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>Markdown for the model to paste verbatim (RichText renders it as a real table with
    /// Excel/CSV download). Additive metrics also get a share-of-total column/table.</summary>
    public static string ToMarkdown(CustomDataset d, bool split)
    {
        var sb = new StringBuilder();
        if (!split)
        {
            var values = d.Series[0].Values;
            var total = d.Additive ? values.Sum(v => v ?? 0) : 0;
            sb.AppendLine(d.Additive ? $"| {d.CategoryAxis} | {d.Metric} | Share |" : $"| {d.CategoryAxis} | {d.Metric} |");
            sb.AppendLine(d.Additive ? "|---|---|---|" : "|---|---|");
            for (var i = 0; i < d.Categories.Count; i++)
            {
                var share = d.Additive && total > 0 ? $" {(values[i] ?? 0) / total * 100:0.0}% |" : "";
                sb.AppendLine($"| {d.Categories[i]} | {Fmt(values[i], d.Unit)} |{share}".TrimEnd());
            }
            if (d.Additive) sb.AppendLine($"| Total | {Fmt(total, d.Unit)} | 100.0% |");
            return sb.ToString().TrimEnd();
        }

        sb.AppendLine($"| Sale | {string.Join(" | ", d.Series.Select(s => s.Name))} |");
        sb.AppendLine($"|---|{string.Join("|", d.Series.Select(_ => "---"))}|");
        for (var c = 0; c < d.Categories.Count; c++)
            sb.AppendLine($"| {d.Categories[c]} | {string.Join(" | ", d.Series.Select(s => Fmt(s.Values[c], d.Unit)))} |");
        if (d.Additive)
        {
            sb.AppendLine().AppendLine($"| Share of {d.Metric} | {string.Join(" | ", d.Series.Select(s => s.Name))} |");
            sb.AppendLine($"|---|{string.Join("|", d.Series.Select(_ => "---"))}|");
            for (var c = 0; c < d.Categories.Count; c++)
            {
                var total = d.Series.Sum(s => s.Values[c] ?? 0);
                sb.AppendLine($"| {d.Categories[c]} | {string.Join(" | ", d.Series.Select(s => total > 0 ? $"{(s.Values[c] ?? 0) / total * 100:0.0}%" : "–"))} |");
            }
        }
        return sb.ToString().TrimEnd();
    }

    // ---------------------------------------------------------------- charts

    /// <summary>Validates a chart request against the dataset's shape and returns the fenced spec
    /// block the frontend renders, or an error the model can act on.</summary>
    public static bool TryBuildChartBlock(CustomDataset d, string type, string? title, out string block, out string? error)
    {
        block = "";
        error = null;
        type = (type ?? "").Trim().ToLowerInvariant();
        if (!ChartTypes.Contains(type)) { error = $"Unknown chart type '{type}'. Use one of: {string.Join(", ", ChartTypes)}."; return false; }

        var multi = d.Series.Count > 1;
        if (type is "stacked_bar" or "percent_stacked_bar" && !multi)
        { error = $"'{type}' needs a dataset with several series (call query_data with split_by='sale'). For one series use bar, horizontal_bar or pie."; return false; }
        if (type == "percent_stacked_bar" && !d.Additive)
        { error = "percent_stacked_bar only makes sense for totals (quantity, proceeds, lots), not averages. Use line or bar."; return false; }
        if (type == "pie" && (multi || !d.Additive))
        { error = "pie needs a single-series dataset of additive totals (no split_by, and not average price). Use percent_stacked_bar for shares across sales."; return false; }
        if (type == "line" && d.Categories.Count < 2)
        { error = "line needs at least two categories. Use bar instead."; return false; }
        if (d.Series.Count == 0 || d.Categories.Count == 0) { error = "The dataset has no data to chart."; return false; }

        var spec = new
        {
            type,
            title = string.IsNullOrWhiteSpace(title) ? d.Title : title.Trim(),
            unit = d.Unit,
            subtitle = d.Scope,
            categoryAxis = d.CategoryAxis,
            categories = d.Categories,
            series = d.Series.Select(s => new { name = s.Name, values = s.Values }),
        };
        block = "```asc-chart\n" + JsonSerializer.Serialize(spec) + "\n```";
        return true;
    }

    private static readonly Regex Placeholder = new(@"\[\[\s*chart\s*:\s*([a-f0-9]{8})\s*\]\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Swaps each [[chart:id]] the model pasted for the real chart block; charts that were
    /// made but never referenced are appended so a forgetful model can't silently lose one, and
    /// unknown ids are dropped rather than shown to the user as junk.</summary>
    public static string ResolvePlaceholders(string reply, IReadOnlyDictionary<string, string> blocks, IEnumerable<string> madeIds)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var resolved = Placeholder.Replace(reply, m =>
        {
            var id = m.Groups[1].Value;
            if (!blocks.TryGetValue(id, out var block)) return "";
            used.Add(id);
            return "\n" + block + "\n";
        });
        var missing = madeIds.Distinct(StringComparer.OrdinalIgnoreCase).Where(id => !used.Contains(id) && blocks.ContainsKey(id)).ToList();
        foreach (var id in missing) resolved += "\n\n" + blocks[id];
        return resolved;
    }
}

/// <summary>
/// The Reports Agent's custom-report tools: query_data (filter + group + optional per-sale split
/// over the MSL archive, via the same engine the Analysis screen uses) and make_chart (draws a
/// stored dataset). Read-only; numbers never pass through the model — it gets a dataset id and a
/// markdown table, and a [[chart:id]] placeholder that the server expands after the reply.
/// </summary>
public class CustomReportTools(MslFilteredAnalyticsEngine engine, IMemoryCache cache, ILogger<CustomReportTools> logger)
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(30);
    private static string DatasetKey(string id) => "customreport:dataset:" + id;
    private static string ChartKey(string id) => "customreport:chart:" + id;

    public static readonly IReadOnlyList<ToolDef> Definitions =
    [
        new ToolDef(
            "query_data",
            "Build a custom cross-broker table from the full Colombo auction archive (all 8 brokers, 13 years): " +
            "filter the lots, group them by one dimension, optionally split across recent sales, and pick a measure. " +
            "Use it for ANY 'how is X shared/split/distributed among Y' or 'trend of X over sales' question — e.g. off-grade " +
            "quantity shared among brokers = grade_types ['Off Grade'], group_by 'broker', metric 'quantity_kg'. " +
            "Returns a datasetId (pass it to make_chart to draw it) and a markdownTable to paste verbatim. " +
            "With no years/sale_nos and no split_by it covers only the LATEST sale — pass years or split_by='sale' for more.",
            new
            {
                type = "object",
                properties = new
                {
                    group_by = new { type = "string", description = "What to break the data down by: " + string.Join(" | ", CustomReportLogic.Dimensions) + "." },
                    metric = new { type = "string", description = "Measure: " + string.Join(" | ", CustomReportLogic.Metrics.Keys) + ". Default quantity_kg (quantity offered)." },
                    split_by = new { type = "string", description = "Optional: 'sale' repeats the breakdown for each of the most recent sales (needed for trends and stacked charts)." },
                    last_n_sales = new { type = "integer", description = $"With split_by='sale': how many recent sales. Default {CustomReportLogic.DefaultSales}, max {CustomReportLogic.MaxSales}." },
                    top_n = new { type = "integer", description = $"Keep the top N groups; the rest fold into 'Other'. Default 8, max {CustomReportLogic.MaxCategories}." },
                    years = new { type = "array", items = new { type = "integer" }, description = "Sale years to include, e.g. [2026]." },
                    sale_nos = new { type = "array", items = new { type = "integer" }, description = "Sale numbers within those years." },
                    brokers = new { type = "array", items = new { type = "string" }, description = "Restrict to brokers: ASC, BC, CT, EB, FW, JK, LC, MPB." },
                    categories = new { type = "array", items = new { type = "string" }, description = "Catalogue categories (e.g. 'Off Grade', 'High & Medium', 'Ex-estate'). Wrong values return the valid list." },
                    grade_types = new { type = "array", items = new { type = "string" }, description = "'Main Grade' and/or 'Off Grade'." },
                    tea_types = new { type = "array", items = new { type = "string" }, description = "'Black Tea' and/or 'Green Tea'." },
                    manufactures = new { type = "array", items = new { type = "string" }, description = "Manufacture type, e.g. 'Orthodox' or 'CTC'." },
                    elevations = new { type = "array", items = new { type = "string" }, description = "UVA HIGH, WESTERN HIGH, UVA MEDIUM, WESTERN MEDIUM, LOW." },
                    grades = new { type = "array", items = new { type = "string" }, description = "Specific grade codes, e.g. ['BOP', 'BOPF']." },
                    sold_status = new { type = "string", description = "'sold' or 'unsold'." },
                    sale_type = new { type = "string", description = "'public' or 'private'." },
                    title = new { type = "string", description = "Optional report/chart title." },
                },
                required = new[] { "group_by" },
            }),
        new ToolDef(
            "make_chart",
            "Draw a chart from a query_data result. Returns a chartPlaceholder like [[chart:1a2b3c4d]] — paste it VERBATIM on its own " +
            "line in your answer where the chart should appear; the system replaces it with the real chart. Types: bar, horizontal_bar, " +
            "pie (single series of totals), line (trends), stacked_bar and percent_stacked_bar (need split_by='sale'; percent = share of total per sale). " +
            "Pick what suits the question; 'shared among' questions read best as pie (one period) or percent_stacked_bar (across sales).",
            new
            {
                type = "object",
                properties = new
                {
                    dataset_id = new { type = "string", description = "The datasetId returned by query_data." },
                    type = new { type = "string", description = string.Join(" | ", CustomReportLogic.ChartTypes) },
                    title = new { type = "string", description = "Optional chart title (defaults to the query's title)." },
                },
                required = new[] { "dataset_id", "type" },
            }),
    ];

    public static bool IsCustomTool(string name) => Definitions.Any(d => d.Name == name);

    public async Task<string> ExecuteAsync(string name, string argumentsJson, CancellationToken ct = default)
    {
        logger.LogInformation("Custom report tool call: {Tool} args={Args}", name, argumentsJson);
        try
        {
            var args = AssistantToolExecutor.ParseArgs(argumentsJson);
            return name switch
            {
                "query_data" => await QueryDataAsync(args, ct),
                "make_chart" => MakeChart(args),
                _ => JsonSerializer.Serialize(new { error = $"Unknown tool '{name}'." }),
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Custom report tool failed: {Tool} args={Args}", name, argumentsJson);
            return JsonSerializer.Serialize(new { error = $"Tool '{name}' failed: {ex.Message}" });
        }
    }

    private async Task<string> QueryDataAsync(JsonNode args, CancellationToken ct)
    {
        var groupBy = args["group_by"]?.ToString().Trim().ToLowerInvariant().Replace(' ', '_') ?? "";
        if (!CustomReportLogic.Dimensions.Contains(groupBy))
            return Error($"group_by must be one of: {string.Join(", ", CustomReportLogic.Dimensions)}.");
        var metricKey = args["metric"]?.ToString().Trim().ToLowerInvariant() ?? "quantity_kg";
        if (!CustomReportLogic.Metrics.TryGetValue(metricKey, out var metric))
            return Error($"metric must be one of: {string.Join(", ", CustomReportLogic.Metrics.Keys)}.");
        var splitRaw = args["split_by"]?.ToString().Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(splitRaw) && splitRaw is not ("sale" or "none"))
            return Error("split_by must be 'sale' (or omitted).");
        var split = splitRaw == "sale";
        if (split && groupBy == "sale") return Error("Cannot split by sale when already grouping by sale — use group_by='sale' alone for a per-sale trend.");

        var options = await engine.LightweightOptionsAsync(ct);
        if (!CustomReportLogic.TryParseFilter(args, options, out var filter, out var filterError)) return Error(filterError!);

        // Resolve which (year, sale) columns to run.
        var sales = options.Sales
            .Where(s => filter.Years is not { Count: > 0 } || filter.Years.Contains(s.Year))
            .Where(s => filter.SaleNos is not { Count: > 0 } || filter.SaleNos.Contains(s.SaleNo))
            .OrderByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).ToList();
        if (sales.Count == 0)
        {
            var latest = options.Sales.OrderByDescending(s => s.Year).ThenByDescending(s => s.SaleNo).FirstOrDefault();
            return Error("No sales in the archive match those years/sale numbers." +
                (latest is null ? "" : $" The archive's most recent sale is {latest.SaleNo:00}/{latest.Year} — the newest catalogue sale may not be imported yet."));
        }

        var columns = new List<(string Label, IReadOnlyList<FilteredSectionRow> Rows)>();
        string period;
        if (split)
        {
            var n = Math.Clamp(args["last_n_sales"]?.GetValue<int>() ?? CustomReportLogic.DefaultSales, 1, CustomReportLogic.MaxSales);
            var chosen = sales.Take(n).OrderBy(s => s.Year).ThenBy(s => s.SaleNo).ToList();
            foreach (var s in chosen)
            {
                var dto = await engine.FilteredAsync(filter with { Years = [s.Year], SaleNos = [s.SaleNo] }, ct, lite: true);
                columns.Add(($"{s.SaleNo:00}/{s.Year}", CustomReportLogic.Section(dto, groupBy)!));
            }
            period = $"the last {chosen.Count} sale(s), {chosen[0].SaleNo:00}/{chosen[0].Year}–{chosen[^1].SaleNo:00}/{chosen[^1].Year}";
        }
        else
        {
            var explicitScope = filter.Years is { Count: > 0 } || filter.SaleNos is { Count: > 0 };
            var f = explicitScope ? filter : filter with { Years = [sales[0].Year], SaleNos = [sales[0].SaleNo] };
            var dto = await engine.FilteredAsync(f, ct, lite: true);
            columns.Add(("Total", CustomReportLogic.Section(dto, groupBy)!));
            period = explicitScope
                ? (filter.Years is { Count: > 0 } ? $"year(s) {string.Join(", ", filter.Years)}" : "all years") +
                  (filter.SaleNos is { Count: > 0 } ? $", sale(s) {string.Join(", ", filter.SaleNos)}" : "")
                : $"the latest sale only ({sales[0].SaleNo:00}/{sales[0].Year})";
        }

        var topN = Math.Clamp(args["top_n"]?.GetValue<int>() ?? 8, 1, CustomReportLogic.MaxCategories);
        var scope = $"{CustomReportLogic.DescribeFilter(filter)} · {period}";
        var title = args["title"]?.ToString() is { Length: > 0 } t ? t : $"{metric.Label} by {groupBy.Replace('_', ' ')}";
        var id = Guid.NewGuid().ToString("N")[..8];
        var dataset = CustomReportLogic.BuildDataset(id, title, scope, groupBy, metric, split, columns, topN);
        if (dataset.Categories.Count == 0 || dataset.Series.All(s => s.Values.All(v => v is null or 0)))
            return Error($"No data for that selection ({scope}). Loosen a filter or widen the period.");

        cache.Set(DatasetKey(id), dataset, Ttl);
        return JsonSerializer.Serialize(new
        {
            datasetId = id,
            scope,
            title,
            note = "State the scope in your answer. Paste markdownTable verbatim. Then call make_chart with this datasetId if a chart helps.",
            markdownTable = CustomReportLogic.ToMarkdown(dataset, split),
        });
    }

    private string MakeChart(JsonNode args)
    {
        var datasetId = args["dataset_id"]?.ToString().Trim() ?? "";
        if (!cache.TryGetValue(DatasetKey(datasetId), out CustomDataset? dataset) || dataset is null)
            return Error("Unknown or expired dataset_id — call query_data again and use the datasetId it returns.");
        if (!CustomReportLogic.TryBuildChartBlock(dataset, args["type"]?.ToString() ?? "", args["title"]?.ToString(), out var block, out var error))
            return Error(error!);

        var chartId = Guid.NewGuid().ToString("N")[..8];
        cache.Set(ChartKey(chartId), block, Ttl);
        return JsonSerializer.Serialize(new
        {
            chartId,
            chartPlaceholder = $"[[chart:{chartId}]]",
            note = "Paste chartPlaceholder verbatim on its own line where the chart belongs. Do not describe it as an image or link.",
        });
    }

    /// <summary>The chart id inside a make_chart result, or null if the call errored.</summary>
    public static string? TryGetChartId(string toolResult)
    {
        try { return JsonNode.Parse(toolResult)?["chartId"]?.GetValue<string>(); }
        catch (JsonException) { return null; }
    }

    /// <summary>Expands [[chart:id]] placeholders in a finished reply into chart blocks.</summary>
    public string ResolveCharts(string reply, IEnumerable<string> madeIds)
    {
        var blocks = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in Regex.Matches(reply, @"\[\[\s*chart\s*:\s*([a-f0-9]{8})\s*\]\]", RegexOptions.IgnoreCase).Select(m => m.Groups[1].Value).Concat(madeIds))
            if (cache.TryGetValue(ChartKey(m), out string? b) && b is not null) blocks[m] = b;
        return CustomReportLogic.ResolvePlaceholders(reply, blocks, madeIds);
    }

    private static string Error(string message) => JsonSerializer.Serialize(new { error = message });
}
