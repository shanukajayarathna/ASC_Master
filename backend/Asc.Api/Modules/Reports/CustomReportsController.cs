using System.Text.Json.Nodes;
using Asc.Api.Modules.Agents;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Reports;

/// <summary>What the Reports workspace's builder asks for. Every member is optional except the grouping.</summary>
public record CustomPreviewRequest(
    string GroupBy,
    string? Metric,
    bool SplitBySale,
    int? LastNSales,
    List<int>? Years,
    List<string>? Brokers,
    List<string>? Grades,
    int? TopN,
    string? Title);

/// <summary>
/// Live preview for the Reports workspace's builder: the same archive query the Reports Agent's query_data tool
/// runs (CustomReportTools), but driven by the builder's controls instead of a model — so every figure in the
/// preview comes from the system, never from a language model. Read-only; any signed-in user, like the agent.
/// </summary>
[ApiController]
[Route("api/v1/reports/custom")]
[Authorize]
public class CustomReportsController(CustomReportTools tools) : ControllerBase
{
    [HttpPost("preview")]
    public async Task<ActionResult<CustomPreview>> Preview(CustomPreviewRequest request, CancellationToken ct)
    {
        var (preview, error) = await tools.PreviewAsync(ToArgs(request), ct);
        return preview is null ? BadRequest(new { error }) : Ok(preview);
    }

    /// <summary>Maps the request onto the tool's argument names, so validation lives in exactly one place.</summary>
    public static JsonObject ToArgs(CustomPreviewRequest r)
    {
        var args = new JsonObject { ["group_by"] = r.GroupBy };
        if (!string.IsNullOrWhiteSpace(r.Metric)) args["metric"] = r.Metric;
        if (r.SplitBySale) args["split_by"] = "sale";
        if (r.LastNSales is { } n) args["last_n_sales"] = n;
        if (r.Years is { Count: > 0 }) args["years"] = new JsonArray([.. r.Years.Select(y => (JsonNode)JsonValue.Create(y)!)]);
        if (r.Brokers is { Count: > 0 }) args["brokers"] = new JsonArray([.. r.Brokers.Select(b => (JsonNode)JsonValue.Create(b)!)]);
        if (r.Grades is { Count: > 0 }) args["grades"] = new JsonArray([.. r.Grades.Select(g => (JsonNode)JsonValue.Create(g)!)]);
        if (r.TopN is { } top) args["top_n"] = top;
        if (!string.IsNullOrWhiteSpace(r.Title)) args["title"] = r.Title;
        return args;
    }
}
