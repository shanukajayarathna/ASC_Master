using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.LearningContent;

/// <summary>
/// Knowledge Base "Learn" carousel content — module usage guidance, tea education, and
/// articles, admin-managed the same way Market Pulse's sources are (see
/// MarketPulseController, the pattern this mirrors). Reading is any signed-in user (the
/// Knowledge Base page every role sees); writing is Admin-only via the same
/// ManageKnowledgeBase policy that already gates document upload/delete/sync, so this
/// module and the document-library one share one admin surface's worth of permissions
/// rather than inventing a second policy for what is, from a permissions standpoint, the
/// same "who curates Knowledge Base content" question.
/// </summary>
[ApiController]
[Route("api/v1/learning-content")]
[Authorize]
public class LearningContentController(MongoContext db, IAuditLogger audit) : ControllerBase
{
    /// <summary>Published items only, ordered for display — what the Knowledge Base page
    /// itself renders.</summary>
    [HttpGet]
    public async Task<ActionResult<List<LearningContentItemDto>>> Get(CancellationToken ct)
    {
        var items = await db.LearningContentItems.Find(i => i.IsPublished)
            .SortBy(i => i.Category).ThenBy(i => i.Order).ToListAsync(ct);
        return items.Select(ToDto).ToList();
    }

    /// <summary>The admin editor's own load — unfiltered, drafts included, same shape as
    /// the public GET (see MarketPulseController's admin/public split).</summary>
    [HttpGet("admin")]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<ActionResult<List<LearningContentItemDto>>> GetForAdmin(CancellationToken ct)
    {
        var items = await db.LearningContentItems.Find(FilterDefinition<LearningContentItem>.Empty)
            .SortBy(i => i.Category).ThenBy(i => i.Order).ToListAsync(ct);
        return items.Select(ToDto).ToList();
    }

    [HttpPost]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<ActionResult<LearningContentItemDto>> Add([FromBody] CreateLearningContentDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");
        if (!Enum.TryParse<LearningContentCategory>(dto.Category, true, out var category))
            return BadRequest($"Unknown category '{dto.Category}'.");

        var item = new LearningContentItem
        {
            Category = category,
            Title = dto.Title.Trim(),
            Tagline = dto.Tagline.Trim(),
            Body = dto.Body.Trim(),
            ImageUrl = dto.ImageUrl.Trim(),
            VideoUrl = string.IsNullOrWhiteSpace(dto.VideoUrl) ? null : dto.VideoUrl.Trim(),
            Order = dto.Order,
            IsPublished = dto.IsPublished,
            AddedBy = User.Identity?.Name,
            AddedAt = DateTime.UtcNow,
        };
        await db.LearningContentItems.InsertOneAsync(item, cancellationToken: ct);
        await audit.LogAsync(User, "learningContent.added", "LearningContentItem", item.Id.ToString(), item.Title, ct);
        return ToDto(item);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<ActionResult<LearningContentItemDto>> Update(Guid id, [FromBody] UpdateLearningContentDto dto, CancellationToken ct)
    {
        var item = await db.LearningContentItems.Find(i => i.Id == id).FirstOrDefaultAsync(ct);
        if (item is null) return NotFound();

        var ub = Builders<LearningContentItem>.Update;
        var updates = new List<UpdateDefinition<LearningContentItem>>();
        var changes = new List<string>();

        if (dto.Category is not null)
        {
            if (!Enum.TryParse<LearningContentCategory>(dto.Category, true, out var category))
                return BadRequest($"Unknown category '{dto.Category}'.");
            updates.Add(ub.Set(i => i.Category, category));
            changes.Add($"category -> {category}");
        }
        if (dto.Title is not null && dto.Title.Trim().Length > 0 && dto.Title.Trim() != item.Title)
        {
            updates.Add(ub.Set(i => i.Title, dto.Title.Trim()));
            changes.Add("title updated");
        }
        if (dto.Tagline is not null && dto.Tagline.Trim() != item.Tagline)
        {
            updates.Add(ub.Set(i => i.Tagline, dto.Tagline.Trim()));
            changes.Add("tagline updated");
        }
        if (dto.Body is not null && dto.Body.Trim() != item.Body)
        {
            updates.Add(ub.Set(i => i.Body, dto.Body.Trim()));
            changes.Add("body updated");
        }
        if (dto.ImageUrl is not null && dto.ImageUrl.Trim() != item.ImageUrl)
        {
            updates.Add(ub.Set(i => i.ImageUrl, dto.ImageUrl.Trim()));
            changes.Add("image updated");
        }
        // Empty string is the explicit "clear the video back to a coming-soon placeholder"
        // signal, distinct from null ("this field wasn't touched by the editor") — a plain
        // nullable string can't otherwise tell "leave unchanged" apart from "set to null"
        // for a field whose own valid value IS null.
        if (dto.VideoUrl is not null)
        {
            var next = dto.VideoUrl.Trim().Length == 0 ? null : dto.VideoUrl.Trim();
            if (next != item.VideoUrl)
            {
                updates.Add(ub.Set(i => i.VideoUrl, next));
                changes.Add(next is null ? "video cleared" : "video updated");
            }
        }
        if (dto.Order is not null && dto.Order != item.Order)
        {
            updates.Add(ub.Set(i => i.Order, dto.Order.Value));
            changes.Add($"order -> {dto.Order.Value}");
        }
        if (dto.IsPublished is not null && dto.IsPublished != item.IsPublished)
        {
            updates.Add(ub.Set(i => i.IsPublished, dto.IsPublished.Value));
            changes.Add(dto.IsPublished.Value ? "published" : "unpublished");
        }

        if (updates.Count > 0)
        {
            await db.LearningContentItems.UpdateOneAsync(i => i.Id == id, ub.Combine(updates), cancellationToken: ct);
            await audit.LogAsync(User, "learningContent.updated", "LearningContentItem", id.ToString(), string.Join(", ", changes), ct);
        }
        return ToDto(await db.LearningContentItems.Find(i => i.Id == id).FirstAsync(ct));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await db.LearningContentItems.Find(i => i.Id == id).FirstOrDefaultAsync(ct);
        if (item is null) return NotFound();
        await db.LearningContentItems.DeleteOneAsync(i => i.Id == id, ct);
        await audit.LogAsync(User, "learningContent.deleted", "LearningContentItem", id.ToString(), item.Title, ct);
        return NoContent();
    }

    private static LearningContentItemDto ToDto(LearningContentItem i) => new(
        i.Id, i.Category.ToString(), i.Title, i.Tagline, i.Body, i.ImageUrl, i.VideoUrl,
        i.Order, i.IsPublished, i.AddedBy, i.AddedAt);
}
