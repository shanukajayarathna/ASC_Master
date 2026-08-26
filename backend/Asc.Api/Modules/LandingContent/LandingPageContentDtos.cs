namespace Asc.Api.Modules.LandingContent;

public record HeroDto(string Headline, string Subhead, string CtaPrimaryLabel, string CtaSecondaryLabel);
public record CompanyStatsDto(int FoundedYear, long AvgAnnualVolumeKg, int BrokerCount, int YearsOperating);
public record PlatformStatDto(string Label, string Value, bool IsLive, string? LiveSourceKey);
public record IntelligenceItemDto(string Title, string Description, string IconKey, int Order);
public record TestimonialDto(Guid Id, string Name, string Role, string Quote, string AvatarUrl, int Order, bool IsPublished);
public record HeritageDto(string PullQuote, string BodyCopy, string ImageUrl);

/// <summary>What both the public GET and the Admin PUT return. The public GET's testimonials
/// list is pre-filtered to <c>IsPublished</c> before this is built; the Admin editor's own load
/// goes through the same shape unfiltered (see <see cref="LandingPageContentController"/>).</summary>
public record LandingPageContentDto(
    HeroDto Hero,
    CompanyStatsDto CompanyStats,
    List<PlatformStatDto> PlatformStats,
    List<IntelligenceItemDto> FiveIntelligences,
    List<TestimonialDto> Testimonials,
    HeritageDto Heritage,
    DateTime UpdatedAt,
    string? UpdatedBy);

/// <summary>Full replace-style update body — the Admin editor always sends the complete
/// content, same as it always loaded the complete content.</summary>
public record UpdateLandingPageContentDto(
    HeroDto Hero,
    CompanyStatsDto CompanyStats,
    List<PlatformStatDto> PlatformStats,
    List<IntelligenceItemDto> FiveIntelligences,
    List<TestimonialDto> Testimonials,
    HeritageDto Heritage);
