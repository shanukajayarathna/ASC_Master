using System.Globalization;
using System.Text.Json.Nodes;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// A fully specified archive question (period, measure, breakdown and filters all chosen in the guided dialogue) needs no
/// language model: the server runs the archive query itself and writes the answer — one headline sentence computed from the
/// figures, the table, the chart, and the scope and source line. Every number is the archive's own, the reply is instant, and
/// it costs no tokens. Anything the archive can't answer falls back to the agents.
/// </summary>
public static class DirectAnswer
{
    public static bool CanAnswer(ResolvedRequest r, ArchiveScope? scope) =>
        scope is not null && r.CatalogueSale is null && r.Metric is not null
        && r.Topic is IntakeTopic.Ranking or IntakeTopic.Prices or IntakeTopic.Volume or IntakeTopic.Compare or IntakeTopic.TopPrice
        && (r.GroupBy is not null || r.Topic is IntakeTopic.Prices or IntakeTopic.Volume or IntakeTopic.TopPrice);

    /// <summary>The <c>query_data</c> arguments for this request.</summary>
    public static JsonObject ToArgs(ResolvedRequest r, ArchiveScope scope)
    {
        var groupBy = r.GroupBy ?? "sale";
        var args = new JsonObject { ["group_by"] = groupBy, ["metric"] = r.Metric, ["top_n"] = groupBy == "sale" ? CustomReportLogic.MaxCategories : 8 };
        scope.AddTo(args);
        static JsonArray Arr(IEnumerable<string> v) => new(v.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray());
        if (r.Grades.Count > 0) args["grades"] = Arr(r.Grades);
        if (r.Elevations.Count > 0) args["elevations"] = Arr(r.Elevations);
        if (r.Brokers.Count > 0) args["brokers"] = Arr(r.Brokers);
        if (r.GradeTypes.Count > 0) args["grade_types"] = Arr(r.GradeTypes);
        return args;
    }

    private static string MetricNoun(string? metric) => metric switch
    {
        "avg_price_rs" => "average price",
        "max_price_rs" => "highest price",
        "sold_quantity_kg" => "quantity sold",
        "quantity_kg" => "quantity offered",
        "proceeds_rs" => "proceeds",
        "sold_lots" => "lots sold",
        "lots" => "lots offered",
        "share_of_own_volume_pct" => "share of own volume",
        _ => "value",
    };

    private static string Format(decimal v, string unit) => unit switch
    {
        "Rs/kg" => $"Rs {v.ToString("N2", CultureInfo.InvariantCulture)}/kg",
        "Rs" => $"Rs {v.ToString("N0", CultureInfo.InvariantCulture)}",
        "kg" => $"{v.ToString("N0", CultureInfo.InvariantCulture)} kg",
        "%" => $"{v.ToString("N1", CultureInfo.InvariantCulture)}%",
        _ => v.ToString("N0", CultureInfo.InvariantCulture),
    };

    private static string Filters(ResolvedRequest r)
    {
        var parts = new List<string>();
        if (r.Grades.Count > 0) parts.Add(string.Join("/", r.Grades));
        if (r.Brokers.Count > 0) parts.Add(string.Join("/", r.Brokers));
        if (r.Elevations.Count > 0) parts.Add(string.Join("/", r.Elevations).ToLowerInvariant());
        if (r.GradeTypes.Count > 0) parts.Add(string.Join("/", r.GradeTypes).ToLowerInvariant());
        return parts.Count == 0 ? "" : " for " + string.Join(", ", parts);
    }

    /// <summary>The finished chat reply, or null when the archive returned nothing usable (the agents then take over).</summary>
    public static string? Reply(ResolvedRequest r, CustomPreview p)
    {
        if (p.Series.Count == 0 || p.Categories.Count == 0) return null;
        var byTime = p.CategoryAxis == "Sale";
        var rows = p.Categories.Select((c, i) => (Name: c, Value: p.Series[0].Values[i])).ToList();
        if (byTime) rows = [.. rows.OrderBy(x => CustomReportLogic.SaleOrderKey(x.Name))];
        var real = rows.Where(x => x.Name != "Other" && x.Value is not null).Select(x => (x.Name, Value: x.Value!.Value)).ToList();
        if (real.Count == 0) return null;

        var noun = MetricNoun(r.Metric);
        var what = Filters(r);
        var axis = p.CategoryAxis.ToLowerInvariant();
        var top = real.MaxBy(x => x.Value);
        var low = real.MinBy(x => x.Value);
        string headline;

        if (r.Topic == IntakeTopic.TopPrice)
            headline = byTime
                ? $"The highest price{what} was {Format(top.Value, p.Unit)}, in sale {top.Name}."
                : $"The highest price{what} was {Format(top.Value, p.Unit)}, for {top.Name}.";
        else if (r.Topic == IntakeTopic.Ranking)
        {
            var total = rows.Sum(x => x.Value ?? 0);
            var share = p.Additive && total > 0 ? $" ({top.Value / total * 100:0.0}% of the total shown)" : "";
            headline = $"Top {axis} by {noun}{what}: {top.Name} — {Format(top.Value, p.Unit)}{share}.";
        }
        else if (real.Count == 1)
            headline = $"{char.ToUpperInvariant(noun[0])}{noun[1..]}{what}: {Format(top.Value, p.Unit)} ({real[0].Name}).";
        else
            headline = $"Highest {noun}{what}: {top.Name} at {Format(top.Value, p.Unit)}; lowest: {low.Name} at {Format(low.Value, p.Unit)}.";

        var text = new List<string> { headline, "", p.MarkdownTable };

        if (real.Count >= 2)
        {
            var dataset = new CustomDataset("direct", p.Title, p.Scope, p.Metric, p.Unit, p.Additive, p.CategoryAxis, p.Categories, p.Series);
            var type = byTime ? "line" : p.Categories.Count > 8 ? "horizontal_bar" : "bar";
            if (CustomReportLogic.TryBuildChartBlock(dataset, type, null, out var block, out _)) { text.Add(""); text.Add(block); }
        }

        text.Add("");
        text.Add($"Scope: {p.Scope} · Source: MSL auction archive (settled results){(r.Metric == "max_price_rs" ? " · the highest single-lot price per kg" : "")}.");
        if (r.Assumed.Count > 0) text.Add($"You let me choose: {string.Join(", ", r.Assumed)}.");
        return string.Join("\n", text);
    }
}
