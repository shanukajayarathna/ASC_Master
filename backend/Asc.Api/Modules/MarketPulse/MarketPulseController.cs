using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarketPulse;

public record MarketPulseItemDto(
    Guid Id, string SourceUrl, string SourceName, string Title, DateTime? PublishedAt,
    string RawSummary, int? AiRelevanceScore, string? AiCategory, string? AiWhyItMatters,
    string Status, DateTime IngestedAt, DateTime? ScoredAt);

public record MarketPulseSourceDto(
    Guid Id, string Name, string FeedUrl, string Category, bool Enabled, string? AddedBy, DateTime AddedAt,
    DateTime? LastFetchedAt, bool? LastFetchSucceeded, string? LastFetchError, int LastFetchNewItems);

public record MarketPulsePagedResultDto(List<MarketPulseItemDto> Items, long Total, int Page, int PageSize);

public record CreateMarketPulseSourceDto(string Name, string FeedUrl, string Category, bool Enabled = true);
public record UpdateMarketPulseSourceDto(string? Name, string? FeedUrl, string? Category, bool? Enabled);

/// <summary>
/// Market Pulse — curated, AI-scored industry news for the dashboard widget and the full
/// <c>/market-pulse</c> page. Every read goes through <see cref="Get"/> (paged/filterable);
/// there is deliberately no second endpoint or client-side filtering logic that could drift
/// from it — "one number, one source" per the module's design principles. Source management
/// and the manual refresh trigger are Admin-only, same policy-per-feature pattern as every
/// other admin surface in this app.
/// </summary>
[ApiController]
[Route("api/v1/market-pulse")]
[Authorize]
public class MarketPulseController(MongoContext db, MarketPulseIngestionEngine engine, IAuditLogger audit) : ControllerBase
{
    /// <summary>Every role sees this — Market Pulse is a dashboard widget for everyone, not
    /// an admin tool. Default view excludes items scored below the ingestion threshold
    /// ("discard" in the spec means "not shown by default," not "deleted" — see
    /// MarketPulseIngestionEngine's doc comment for why); unscored items (AI never reached
    /// them, or every provider failed) are never excluded, so a total AI outage still shows
    /// the raw feed rather than an empty page.</summary>
    [HttpGet]
    public async Task<ActionResult<MarketPulsePagedResultDto>> Get(
        [FromQuery] string? category, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int? minRelevance, [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var fb = Builders<MarketPulseItem>.Filter;
        var filters = new List<FilterDefinition<MarketPulseItem>>();

        if (!string.IsNullOrWhiteSpace(category))
        {
            if (!Enum.TryParse<MarketPulseCategory>(category, true, out var cat))
                return BadRequest($"Unknown category '{category}'.");
            filters.Add(fb.Eq(i => i.AiCategory, cat));
        }
        if (from is not null) filters.Add(fb.Gte(i => i.PublishedAt, from));
        if (to is not null) filters.Add(fb.Lte(i => i.PublishedAt, to));

        var threshold = minRelevance ?? engine.RelevanceThreshold;
        filters.Add(fb.Or(
            fb.Eq(i => i.Status, MarketPulseItemStatus.Pending),
            fb.Eq(i => i.Status, MarketPulseItemStatus.Failed),
            fb.Gte(i => i.AiRelevanceScore, threshold)));

        var filter = fb.And(filters);
        // Mongo sorts null/missing fields ahead of numbers in ascending order, so
        // descending naturally pushes not-yet-scored items after every scored one —
        // exactly "relevance first, recency next, unscored last" without a synthetic
        // coalesce in the sort key.
        var find = db.MarketPulseItems.Find(filter).SortByDescending(i => i.AiRelevanceScore).ThenByDescending(i => i.PublishedAt);

        var total = await find.CountDocumentsAsync(ct);
        var items = await find.Skip((page - 1) * pageSize).Limit(pageSize).ToListAsync(ct);
        return new MarketPulsePagedResultDto(items.Select(ToDto).ToList(), total, page, pageSize);
    }

    [HttpGet("sources")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageMarketPulse)]
    public async Task<ActionResult<List<MarketPulseSourceDto>>> ListSources(CancellationToken ct)
    {
        var sources = await db.MarketPulseSources.Find(FilterDefinition<MarketPulseSource>.Empty)
            .SortBy(s => s.Name).ToListAsync(ct);
        return sources.Select(ToDto).ToList();
    }

    [HttpPost("sources")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageMarketPulse)]
    public async Task<ActionResult<MarketPulseSourceDto>> AddSource([FromBody] CreateMarketPulseSourceDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
        if (!Uri.TryCreate(dto.FeedUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return BadRequest("feedUrl must be a valid http(s) URL.");
        if (!Enum.TryParse<MarketPulseCategory>(dto.Category, true, out var category))
            return BadRequest($"Unknown category '{dto.Category}'.");

        var source = new MarketPulseSource
        {
            Name = dto.Name.Trim(),
            FeedUrl = dto.FeedUrl.Trim(),
            Category = category,
            Enabled = dto.Enabled,
            AddedBy = User.Identity?.Name,
            AddedAt = DateTime.UtcNow,
        };
        await db.MarketPulseSources.InsertOneAsync(source, cancellationToken: ct);
        await audit.LogAsync(User, "marketPulse.sourceAdded", "MarketPulseSource", source.Id.ToString(), $"{source.Name} ({source.FeedUrl})", ct);
        return ToDto(source);
    }

    [HttpPut("sources/{id:guid}")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageMarketPulse)]
    public async Task<ActionResult<MarketPulseSourceDto>> UpdateSource(Guid id, [FromBody] UpdateMarketPulseSourceDto dto, CancellationToken ct)
    {
        var source = await db.MarketPulseSources.Find(s => s.Id == id).FirstOrDefaultAsync(ct);
        if (source is null) return NotFound();

        var ub = Builders<MarketPulseSource>.Update;
        var updates = new List<UpdateDefinition<MarketPulseSource>>();
        var changes = new List<string>();

        if (dto.Name is not null && dto.Name.Trim().Length > 0 && dto.Name.Trim() != source.Name)
        {
            updates.Add(ub.Set(s => s.Name, dto.Name.Trim()));
            changes.Add($"name -> {dto.Name.Trim()}");
        }
        if (dto.FeedUrl is not null && dto.FeedUrl.Trim() != source.FeedUrl)
        {
            if (!Uri.TryCreate(dto.FeedUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return BadRequest("feedUrl must be a valid http(s) URL.");
            updates.Add(ub.Set(s => s.FeedUrl, dto.FeedUrl.Trim()));
            changes.Add($"feedUrl -> {dto.FeedUrl.Trim()}");
        }
        if (dto.Category is not null)
        {
            if (!Enum.TryParse<MarketPulseCategory>(dto.Category, true, out var category))
                return BadRequest($"Unknown category '{dto.Category}'.");
            updates.Add(ub.Set(s => s.Category, category));
            changes.Add($"category -> {category}");
        }
        if (dto.Enabled is not null && dto.Enabled != source.Enabled)
        {
            updates.Add(ub.Set(s => s.Enabled, dto.Enabled.Value));
            changes.Add(dto.Enabled.Value ? "enabled" : "disabled");
        }

        if (updates.Count > 0)
        {
            await db.MarketPulseSources.UpdateOneAsync(s => s.Id == id, ub.Combine(updates), cancellationToken: ct);
            await audit.LogAsync(User, "marketPulse.sourceUpdated", "MarketPulseSource", id.ToString(), string.Join(", ", changes), ct);
        }
        return ToDto(await db.MarketPulseSources.Find(s => s.Id == id).FirstAsync(ct));
    }

    [HttpDelete("sources/{id:guid}")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageMarketPulse)]
    public async Task<IActionResult> DeleteSource(Guid id, CancellationToken ct)
    {
        var source = await db.MarketPulseSources.Find(s => s.Id == id).FirstOrDefaultAsync(ct);
        if (source is null) return NotFound();
        await db.MarketPulseSources.DeleteOneAsync(s => s.Id == id, ct);
        await audit.LogAsync(User, "marketPulse.sourceDeleted", "MarketPulseSource", id.ToString(), source.Name, ct);
        return NoContent();
    }

    /// <summary>Runs the same ingestion pass the scheduled job runs, immediately — the
    /// spec's "an admin can add a source and see it take effect without waiting for the
    /// next scheduled run."</summary>
    [HttpPost("refresh")]
    [Authorize(Policy = Asc.Api.Modules.Auth.Policies.ManageMarketPulse)]
    public async Task<ActionResult<MarketPulseIngestionSummary>> Refresh(CancellationToken ct)
    {
        var summary = await engine.RunOnceAsync(ct);
        await audit.LogAsync(User, "marketPulse.refreshTriggered", "MarketPulse", null,
            $"{summary.NewItems} new, {summary.Scored} scored, {summary.SourcesFailed} source(s) failed of {summary.SourcesChecked}", ct);
        return summary;
    }

    private static MarketPulseItemDto ToDto(MarketPulseItem i) => new(
        i.Id, i.SourceUrl, i.SourceName, i.Title, i.PublishedAt, i.RawSummary,
        i.AiRelevanceScore, i.AiCategory?.ToString(), i.AiWhyItMatters, i.Status.ToString(), i.IngestedAt, i.ScoredAt);

    private static MarketPulseSourceDto ToDto(MarketPulseSource s) => new(
        s.Id, s.Name, s.FeedUrl, s.Category.ToString(), s.Enabled, s.AddedBy, s.AddedAt,
        s.LastFetchedAt, s.LastFetchSucceeded, s.LastFetchError, s.LastFetchNewItems);
}
