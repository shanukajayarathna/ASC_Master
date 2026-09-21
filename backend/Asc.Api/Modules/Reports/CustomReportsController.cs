using System.Security.Claims;
using System.Text.Json.Nodes;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.ScheduledReports;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Reports;

/// <summary>What the Reports workspace's builder asks for. Every member is optional except the grouping.</summary>
public record CreateSpecRequest(string Title, CustomPreviewRequest Request, string? Visual);

public record CustomReportSpecDto(
    Guid Id, string Title, CustomPreviewRequest Request, string Visual, DateTime CreatedAt, DateTime? LastRunAt, Guid? LastSavedReportId, string? LastError);

public record CustomPreviewRequest(
    string GroupBy,
    string? Metric,
    bool SplitBySale,
    int? LastNSales,
    List<int>? Years,
    List<string>? Brokers,
    List<string>? Grades,
    int? TopN,
    string? Title,
    // A chosen stretch of the archive (see ArchiveScope) and an off-grade / main-grade filter.
    int? FromYear = null,
    int? FromSale = null,
    int? ToYear = null,
    int? ToSale = null,
    List<string>? GradeTypes = null);

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

    // ---- scheduled specs -------------------------------------------------------------------------------------

    public const int MaxSpecsPerUser = 10;

    /// <summary>Null when the spec can be saved, otherwise the message. Only the cheap, static checks — the archive
    /// itself is never queried just to validate a schedule.</summary>
    public static string? ValidateSpec(CreateSpecRequest? r)
    {
        if (r?.Request is null) return "A scheduled report needs the builder settings.";
        if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Trim().Length > 200) return "A scheduled report needs a title of up to 200 characters.";
        if (!CustomReportLogic.Dimensions.Contains((r.Request.GroupBy ?? "").Trim().ToLowerInvariant())) return $"groupBy must be one of: {string.Join(", ", CustomReportLogic.Dimensions)}.";
        if (!string.IsNullOrWhiteSpace(r.Request.Metric) && !CustomReportLogic.Metrics.ContainsKey(r.Request.Metric.Trim())) return $"metric must be one of: {string.Join(", ", CustomReportLogic.Metrics.Keys)}.";
        if (r.Visual is not null && r.Visual is not ("bar" or "line" or "table")) return "visual must be bar, line or table.";
        return null;
    }

    private string OwnerId => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

    [HttpPost("specs")]
    public async Task<ActionResult<CustomReportSpecDto>> CreateSpec(CreateSpecRequest request, CancellationToken ct)
    {
        if (ValidateSpec(request) is { } problem) return BadRequest(new { error = problem });
        if (await db.CustomReportSpecs.CountDocumentsAsync(s => s.OwnerId == OwnerId, cancellationToken: ct) >= MaxSpecsPerUser)
            return BadRequest(new { error = $"You can schedule at most {MaxSpecsPerUser} reports — remove one first." });

        var spec = new CustomReportSpec
        {
            OwnerId = OwnerId,
            OwnerName = User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue(ClaimTypes.Email) ?? "a user",
            Title = request.Title.Trim(),
            RequestJson = CustomReportSnapshot.Serialize(request.Request),
            Visual = request.Visual ?? "bar",
        };
        await db.CustomReportSpecs.InsertOneAsync(spec, cancellationToken: ct);
        await audit.LogAsync(User, "report.spec.scheduled", nameof(CustomReportSpec), spec.Id.ToString(), $"{spec.Title} (weekly)", ct);
        return Ok(ToDto(spec));
    }

    [HttpGet("specs")]
    public async Task<ActionResult<List<CustomReportSpecDto>>> MySpecs(CancellationToken ct)
    {
        var specs = await db.CustomReportSpecs.Find(s => s.OwnerId == OwnerId).SortByDescending(s => s.CreatedAt).ToListAsync(ct);
        return Ok(specs.Select(ToDto).ToList());
    }

    /// <summary>The owner may remove their own schedule; an Admin may remove any.</summary>
    [HttpDelete("specs/{id:guid}")]
    public async Task<IActionResult> DeleteSpec(Guid id, CancellationToken ct)
    {
        var spec = await db.CustomReportSpecs.Find(s => s.Id == id).FirstOrDefaultAsync(ct);
        if (spec is null) return NotFound();
        if (spec.OwnerId != OwnerId && !User.IsInRole("Admin")) return Forbid();
        await db.CustomReportSpecs.DeleteOneAsync(s => s.Id == id, ct);
        await audit.LogAsync(User, "report.spec.removed", nameof(CustomReportSpec), id.ToString(), spec.Title, ct);
        return NoContent();
    }

    public static CustomReportSpecDto ToDto(CustomReportSpec s) => new(
        s.Id, s.Title, CustomReportSnapshot.Deserialize(s.RequestJson) ?? new CustomPreviewRequest("broker", null, false, null, null, null, null, null, null),
        s.Visual, s.CreatedAt, s.LastRunAt, s.LastSavedReportId, s.LastError);

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
        if (r.FromYear is { } fy) args["from_year"] = fy;
        if (r.FromSale is { } fs) args["from_sale"] = fs;
        if (r.ToYear is { } ty) args["to_year"] = ty;
        if (r.ToSale is { } ts) args["to_sale"] = ts;
        if (r.GradeTypes is { Count: > 0 }) args["grade_types"] = new JsonArray([.. r.GradeTypes.Select(g => (JsonNode)JsonValue.Create(g)!)]);
        return args;
    }
}
