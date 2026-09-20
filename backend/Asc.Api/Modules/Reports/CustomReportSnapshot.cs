using System.Text.Json;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Modules.Reports;

/// <summary>Builds the markdown a Saved Report snapshot stores for a custom report: title, scope, an asc-chart block
/// (unless it was designed as a table), the data table and the source line. Mirrors what the workspace's own
/// "Save snapshot" stores, so a scheduled snapshot renders exactly like a manual one on the Saved Reports page.</summary>
public static class CustomReportSnapshot
{
    public const string SourceLine = "Source: ASC Intelligence Hub — MSL auction archive.";

    /// <summary>The chart type for a visual choice, or null for a table. A line needs two points; a long single series reads better sideways.</summary>
    public static string? ChartType(CustomPreview p, string visual)
    {
        if (visual == "table" || p.Categories.Count == 0) return null;
        if (visual == "line" && p.Categories.Count >= 2) return "line";
        return p.Series.Count == 1 && p.Categories.Count > 8 ? "horizontal_bar" : "bar";
    }

    public static string Build(CustomPreview p, string visual)
    {
        var lines = new List<string> { $"## {p.Title}", p.Scope, "" };
        if (ChartType(p, visual) is { } type)
        {
            var dataset = new CustomDataset("", p.Title, p.Scope, p.Metric, p.Unit, p.Additive, p.CategoryAxis, p.Categories, p.Series);
            if (CustomReportLogic.TryBuildChartBlock(dataset, type, null, out var block, out _))
            {
                lines.Add(block);
                lines.Add("");
            }
        }
        lines.Add(p.MarkdownTable);
        lines.Add("");
        lines.Add($"_{SourceLine}_");
        return string.Join("\n", lines);
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string Serialize(CustomPreviewRequest request) => JsonSerializer.Serialize(request, Json);

    public static CustomPreviewRequest? Deserialize(string json)
    {
        try { return JsonSerializer.Deserialize<CustomPreviewRequest>(json, Json); }
        catch (JsonException) { return null; }
    }
}
