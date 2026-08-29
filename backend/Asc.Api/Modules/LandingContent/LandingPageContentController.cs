using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Documents;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.LandingContent;

/// <summary>
/// CMS content for the public marketing page (/home) — the "wow" landing page's copy, stats,
/// testimonials and "5 Intelligences" grid, all Admin-editable without a deploy. Reading is
/// public (the page itself is public); writing is Admin-only. Single-document collection.
/// </summary>
[ApiController]
[Route("api/v1/landing-content")]
public class LandingPageContentController(MongoContext db, IAuditLogger audit) : ControllerBase
{
    /// <summary>Public, unauthenticated — this is the content the /home page itself renders.
    /// Unpublished testimonial drafts are filtered out here so they never reach a visitor.</summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<LandingPageContentDto>> Get(CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var content = await db.LandingPageContent.Find(FilterDefinition<LandingPageContent>.Empty).FirstOrDefaultAsync(ct);
        if (content is null) return NotFound();

        var stats = await ResolveLiveStatsAsync(content.PlatformStats, ct);
        var testimonials = content.Testimonials.Where(t => t.IsPublished).OrderBy(t => t.Order).ToList();
        // includeAudit: false — UpdatedBy is the editing admin's internal user id; anonymous
        // visitors on the public page have no legitimate use for it.
        return ToDto(content, stats, testimonials, includeAudit: false);
    }

    /// <summary>Admin editor's own load — same shape as the public GET, but unfiltered (drafts
    /// included) so the editor can show and toggle them.</summary>
    [HttpGet("admin")]
    [Authorize(Policy = Policies.ManageLandingContent)]
    public async Task<ActionResult<LandingPageContentDto>> GetForAdmin(CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var content = await db.LandingPageContent.Find(FilterDefinition<LandingPageContent>.Empty).FirstOrDefaultAsync(ct);
        if (content is null) return NotFound();

        var stats = await ResolveLiveStatsAsync(content.PlatformStats, ct);
        return ToDto(content, stats, content.Testimonials.OrderBy(t => t.Order).ToList(), includeAudit: true);
    }

    [HttpPut]
    [Authorize(Policy = Policies.ManageLandingContent)]
    public async Task<ActionResult<LandingPageContentDto>> Update(UpdateLandingPageContentDto dto, CancellationToken ct)
    {
        var validationError = Validate(dto);
        if (validationError is not null) return BadRequest(validationError);

        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var content = await db.LandingPageContent.Find(FilterDefinition<LandingPageContent>.Empty).FirstOrDefaultAsync(ct)
            ?? new LandingPageContent();

        content.Hero = new HeroContent
        {
            Headline = dto.Hero.Headline,
            Subhead = dto.Hero.Subhead,
            CtaPrimaryLabel = dto.Hero.CtaPrimaryLabel,
            CtaSecondaryLabel = dto.Hero.CtaSecondaryLabel,
        };
        content.CompanyStats = new CompanyStatsContent
        {
            FoundedYear = dto.CompanyStats.FoundedYear,
            YearsOperating = dto.CompanyStats.YearsOperating,
            Ranking = dto.CompanyStats.Ranking,
            MarketShareLabel = dto.CompanyStats.MarketShareLabel,
            EmployeeCount = dto.CompanyStats.EmployeeCount,
            WarehouseCount = dto.CompanyStats.WarehouseCount,
            Vision = dto.CompanyStats.Vision,
            Mission = dto.CompanyStats.Mission,
        };
        content.PlatformStats = dto.PlatformStats
            .Select(s => new PlatformStat { Label = s.Label, Value = s.Value, IsLive = s.IsLive, LiveSourceKey = s.LiveSourceKey })
            .ToList();
        content.FiveIntelligences = dto.FiveIntelligences
            .Select(i => new IntelligenceItem { Title = i.Title, Description = i.Description, IconKey = i.IconKey, Order = i.Order })
            .ToList();
        content.Testimonials = dto.Testimonials
            .Select(t => new Testimonial { Id = t.Id, Name = t.Name, Role = t.Role, Quote = t.Quote, AvatarUrl = t.AvatarUrl, Order = t.Order, IsPublished = t.IsPublished })
            .ToList();
        content.Heritage = new HeritageContent
        {
            PullQuote = dto.Heritage.PullQuote,
            BodyCopy = dto.Heritage.BodyCopy,
            ImageUrl = dto.Heritage.ImageUrl,
        };
        content.UpdatedAt = DateTime.UtcNow;
        content.UpdatedBy = User.Identity?.Name;

        await db.LandingPageContent.ReplaceOneAsync(c => c.Id == content.Id, content, new ReplaceOptions { IsUpsert = true }, ct);
        await audit.LogAsync(User, "landingContent.updated", "LandingPageContent", content.Id.ToString(), "Landing page content updated", ct);

        var stats = await ResolveLiveStatsAsync(content.PlatformStats, ct);
        return ToDto(content, stats, content.Testimonials.OrderBy(t => t.Order).ToList(), includeAudit: true);
    }

    private const int ShortFieldMaxLength = 200;
    private const int LongFieldMaxLength = 2000;

    /// <summary>Every CMS string field was previously stored verbatim with no length cap and
    /// no shape check on the two URL fields — a careless or compromised admin session could
    /// otherwise write unbounded text or point an image at an arbitrary external host. Mirrors
    /// the http(s)-scheme check <see cref="Asc.Api.Modules.MarketPulse.MarketPulseController"/>
    /// already applies to its own admin-writable URL field, extended to also accept the
    /// site-relative "/tea/..." paths this app actually stores for images.</summary>
    private static string? Validate(UpdateLandingPageContentDto dto)
    {
        if (TooLong(dto.Hero.Headline, ShortFieldMaxLength) || TooLong(dto.Hero.Subhead, LongFieldMaxLength)
            || TooLong(dto.Hero.CtaPrimaryLabel, ShortFieldMaxLength) || TooLong(dto.Hero.CtaSecondaryLabel, ShortFieldMaxLength))
            return "Hero fields exceed the maximum allowed length.";

        if (TooLong(dto.CompanyStats.Ranking, ShortFieldMaxLength) || TooLong(dto.CompanyStats.MarketShareLabel, ShortFieldMaxLength)
            || TooLong(dto.CompanyStats.Vision, LongFieldMaxLength) || TooLong(dto.CompanyStats.Mission, LongFieldMaxLength))
            return "Company stats fields exceed the maximum allowed length.";

        if (TooLong(dto.Heritage.PullQuote, ShortFieldMaxLength) || TooLong(dto.Heritage.BodyCopy, LongFieldMaxLength))
            return "Heritage fields exceed the maximum allowed length.";
        if (!IsAllowedImageUrl(dto.Heritage.ImageUrl))
            return "Heritage image URL must be a site-relative path or an http(s) URL.";

        foreach (var item in dto.FiveIntelligences)
        {
            if (TooLong(item.Title, ShortFieldMaxLength) || TooLong(item.Description, LongFieldMaxLength))
                return "A '5 Intelligences' item exceeds the maximum allowed length.";
        }

        foreach (var t in dto.Testimonials)
        {
            if (TooLong(t.Name, ShortFieldMaxLength) || TooLong(t.Role, ShortFieldMaxLength) || TooLong(t.Quote, LongFieldMaxLength))
                return "A testimonial field exceeds the maximum allowed length.";
            if (!IsAllowedImageUrl(t.AvatarUrl))
                return "Testimonial avatar URL must be a site-relative path or an http(s) URL.";
        }

        return null;
    }

    private static bool TooLong(string? value, int max) => (value?.Length ?? 0) > max;

    private static bool IsAllowedImageUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return true;
        if (url.StartsWith('/') && !url.StartsWith("//", StringComparison.Ordinal)) return true;
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    /// <summary>Overrides any stat flagged <c>IsLive</c> with a real platform count at read
    /// time — the Admin-entered <see cref="PlatformStat.Value"/> becomes display-only for that
    /// row once live sourcing is on. Currently only "documentsAnalyzed" (Document Intelligence's
    /// processed-document count) is wired; unrecognized keys fall back to the entered value
    /// rather than failing the whole page.</summary>
    private async Task<List<PlatformStat>> ResolveLiveStatsAsync(List<PlatformStat> stats, CancellationToken ct)
    {
        var resolved = new List<PlatformStat>(stats.Count);
        foreach (var stat in stats)
        {
            if (stat is { IsLive: true, LiveSourceKey: "documentsAnalyzed" })
            {
                // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
                var count = await db.Documents.CountDocumentsAsync(FilterDefinition<KnowledgeDocument>.Empty, cancellationToken: ct);
                resolved.Add(new PlatformStat
                {
                    Label = stat.Label,
                    Value = count.ToString("N0"),
                    IsLive = true,
                    LiveSourceKey = stat.LiveSourceKey,
                });
            }
            else
            {
                resolved.Add(stat);
            }
        }
        return resolved;
    }

    private static LandingPageContentDto ToDto(LandingPageContent content, List<PlatformStat> stats, List<Testimonial> testimonials, bool includeAudit) => new(
        new HeroDto(content.Hero.Headline, content.Hero.Subhead, content.Hero.CtaPrimaryLabel, content.Hero.CtaSecondaryLabel),
        new CompanyStatsDto(
            content.CompanyStats.FoundedYear,
            content.CompanyStats.YearsOperating,
            content.CompanyStats.Ranking,
            content.CompanyStats.MarketShareLabel,
            content.CompanyStats.EmployeeCount,
            content.CompanyStats.WarehouseCount,
            content.CompanyStats.Vision,
            content.CompanyStats.Mission),
        stats.Select(s => new PlatformStatDto(s.Label, s.Value, s.IsLive, s.LiveSourceKey)).ToList(),
        content.FiveIntelligences.OrderBy(i => i.Order).Select(i => new IntelligenceItemDto(i.Title, i.Description, i.IconKey, i.Order)).ToList(),
        testimonials.Select(t => new TestimonialDto(t.Id, t.Name, t.Role, t.Quote, t.AvatarUrl, t.Order, t.IsPublished)).ToList(),
        new HeritageDto(content.Heritage.PullQuote, content.Heritage.BodyCopy, content.Heritage.ImageUrl),
        content.UpdatedAt,
        includeAudit ? content.UpdatedBy : null);
}
