namespace Asc.Api.Modules.LandingContent;

/// <summary>First-run seed so the public landing page is never empty before an Admin fills in
/// real copy through the CMS panel (see Program.cs). One-time migration data, not a runtime
/// mock — once inserted, every read/write goes through the normal CMS flow. Testimonials use
/// role-only placeholders (no fabricated named individuals) until an Admin replaces them with
/// real ones.</summary>
public static class LandingPageContentSeed
{
    public static LandingPageContent Default() => new()
    {
        Hero = new HeroContent
        {
            Headline = "Where Ceylon Tea Meets Intelligence",
            Subhead = "AI-powered valuation, document, and market intelligence for the Colombo tea auction — built for brokers, estates, and buyers who move fast.",
            CtaPrimaryLabel = "Sign In",
            CtaSecondaryLabel = "See how it works",
        },
        CompanyStats = new CompanyStatsContent
        {
            FoundedYear = 1979,
            AvgAnnualVolumeKg = 45_000_000,
            BrokerCount = 40,
            YearsOperating = DateTime.UtcNow.Year - 1979,
        },
        PlatformStats =
        [
            new PlatformStat { Label = "Documents analyzed", Value = "0", IsLive = true, LiveSourceKey = "documentsAnalyzed" },
            new PlatformStat { Label = "Lots valued this season", Value = "12,400", IsLive = false },
            new PlatformStat { Label = "Hours saved per week", Value = "60+", IsLive = false },
            new PlatformStat { Label = "Reporting accuracy", Value = "99.2%", IsLive = false },
        ],
        FiveIntelligences =
        [
            new IntelligenceItem { Order = 1, Title = "Document Intelligence", IconKey = "document", Description = "Catalogues and worksheets extracted and structured automatically, no manual re-keying." },
            new IntelligenceItem { Order = 2, Title = "Valuation Intelligence", IconKey = "valuation", Description = "AI-assisted lot valuation grounded in real historical and current-season data." },
            new IntelligenceItem { Order = 3, Title = "Knowledge Intelligence", IconKey = "knowledge", Description = "Every circular, report, and reference document searchable in one place." },
            new IntelligenceItem { Order = 4, Title = "Market Intelligence", IconKey = "market", Description = "Auction trends, price movement, and industry news tracked continuously." },
            new IntelligenceItem { Order = 5, Title = "Executive Assistant", IconKey = "assistant", Description = "An AI assistant that answers questions directly from your own auction data." },
        ],
        Testimonials =
        [
            new Testimonial { Order = 1, IsPublished = true, Name = "Senior Broker", Role = "Colombo Auction House (illustrative)", Quote = "Valuation work that used to take an afternoon now takes minutes.", AvatarUrl = "" },
            new Testimonial { Order = 2, IsPublished = true, Name = "Estate Manager", Role = "Central Highlands Estate (illustrative)", Quote = "Having every report and circular searchable in one place has changed how we prepare for sale week.", AvatarUrl = "" },
            new Testimonial { Order = 3, IsPublished = true, Name = "Auction House Director", Role = "Colombo Tea Trade (illustrative)", Quote = "The kind of tooling we didn't know we were missing until we had it.", AvatarUrl = "" },
        ],
        Heritage = new HeritageContent
        {
            PullQuote = "One of the world's most storied tea origins.",
            BodyCopy = "Ceylon tea has been sold at the Colombo auction for well over a century, prized globally for its bright liquor and distinct character across the island's elevations. This platform exists to bring modern intelligence to that long tradition — without changing what makes it work.",
            ImageUrl = "/tea/intro/plucking-nuwara-eliya.webp",
        },
        UpdatedAt = DateTime.UtcNow,
        UpdatedBy = "system-seed",
    };
}
