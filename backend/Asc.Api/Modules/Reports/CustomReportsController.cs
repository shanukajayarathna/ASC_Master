using System.Text.Json.Nodes;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.ScheduledReports;
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
public class CustomReportsController(CustomReportTools tools, MongoContext db, IGeneratedReportFileStore fileStore, IAuditLogger audit) : ControllerBase
{
    [HttpPost("preview")]
    public async Task<ActionResult<CustomPreview>> Preview(CustomPreviewRequest request, CancellationToken ct)
    {
        var (preview, error) = await tools.PreviewAsync(ToArgs(request), ct);
        return preview is null ? BadRequest(new { error }) : Ok(preview);
    }

    /// <summary>
    /// Generates a PowerPoint deck from report datasets the workspace already showed (native charts and tables,
    /// ASC Ivory or ASC Ink). The file is stored and listed under Saved Reports (downloadable), and the generation
    /// is written to the audit log. Any signed-in user, like every other report action.
    /// </summary>
    [HttpPost("pptx")]
    public async Task<ActionResult<SavedReportDto>> GenerateDeck(CustomDeckRequest request, CancellationToken ct)
    {
        if (CustomDeckGenerator.Validate(request) is { } problem) return BadRequest(new { error = problem });

        var bytes = CustomDeckGenerator.Build(request);
        var slides = CustomDeckGenerator.Plan(request).Count;
        var template = (request.Template ?? "ivory").ToLowerInvariant();
        using var data = new MemoryStream(bytes);
        var fileId = await fileStore.SaveAsync(data, CustomDeckGenerator.FileName(request),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation", ct);

        var saved = new SavedReport
        {
            Type = SavedReport.CustomDeckType,
            Title = request.Title.Trim(),
            Source = "AI Assistant · Reports",
            StoredFileId = fileId,
            Notes = $"{slides} slides · template {template}",
        };
        await db.SavedReports.InsertOneAsync(saved, cancellationToken: ct);
        await audit.LogAsync(User, "report.deck.generated", nameof(SavedReport), saved.Id.ToString(),
            $"{slides} slides, template {template}, {request.Reports.Count} report(s)", ct);
        return Ok(new SavedReportDto(saved.Id, saved.Type, saved.Title, null, saved.Source, saved.CreatedAt, true, saved.Notes));
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
