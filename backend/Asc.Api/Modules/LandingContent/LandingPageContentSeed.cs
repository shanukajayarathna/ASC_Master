namespace Asc.Api.Modules.LandingContent;

/// <summary>First-run seed so the public landing page is never empty before an Admin fills in
/// real copy through the CMS panel (see Program.cs). One-time migration data, not a runtime
/// mock — once inserted, every read/write goes through the normal CMS flow.
///
/// Company facts (founding year, ranking, market share, employee/warehouse counts, vision,
/// mission) are real, sourced from asiasiyaka.lk, not invented — per the "never present
/// invented statistics as verified fact" rule. Testimonials are the one deliberate exception:
/// seeded unpublished (<c>IsPublished = false</c>) since real client quotes need sign-off
/// before they go live on a public page.</summary>
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
            FoundedYear = 1998,
            YearsOperating = DateTime.UtcNow.Year - 1998,
            Ranking = "Top 4 tea broker in Sri Lanka",
            MarketShareLabel = "~15% of Sri Lanka's total traded tea volume over the past 25 years",
            EmployeeCount = 113,
            WarehouseCount = 22,
            Vision = "To be the safe, reliable and value-enhancing facilitator of exchange in the commodity broking industry.",
            Mission = "Driving the commodity broking business forward through modern, high-standard practices and continual value addition — setting the benchmark the industry is measured against.",
        },
        PlatformStats =
        [
            new PlatformStat { Label = "Documents analyzed", Value = "0", IsLive = true, LiveSourceKey = "documentsAnalyzed" },
            new PlatformStat { Label = "Hours saved per week", Value = "60+", IsLive = false },
            new PlatformStat { Label = "Factories served", Value = "300+", IsLive = false },
            new PlatformStat { Label = "Buyers on the floor", Value = "120+", IsLive = false },
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
            new Testimonial { Order = 1, IsPublished = false, Name = "Senior Broker", Role = "Colombo Auction House — sample quote, pending approval", Quote = "Valuation work that used to take an afternoon now takes minutes.", AvatarUrl = "" },
            new Testimonial { Order = 2, IsPublished = false, Name = "Estate Manager", Role = "Central Highlands Estate — sample quote, pending approval", Quote = "Having every report and circular searchable in one place has changed how we prepare for sale week.", AvatarUrl = "" },
            new Testimonial { Order = 3, IsPublished = false, Name = "Auction House Director", Role = "Colombo Tea Trade — sample quote, pending approval", Quote = "The kind of tooling we didn't know we were missing until we had it.", AvatarUrl = "" },
        ],
        Heritage = new HeritageContent
        {
            PullQuote = "One of the world's most storied tea origins.",
            BodyCopy = "Ceylon tea has been sold at the Colombo auction for well over a century. The Sri Lanka Tea Board serves as the industry's national marketing body, and in 2020 the Colombo Tea Auction itself went digital — a shift Asia Siyaka has helped drive as a governing committee member of the Colombo Tea Traders' Association, a board member of the Sri Lanka Tea Board, and a tasting-panel member with the Tea Research Institute. This platform is the next step in that same digitization: modern intelligence brought to a long tradition, without changing what makes it work.",
            ImageUrl = "/tea/intro/plucking-nuwara-eliya.webp",
        },
        UpdatedAt = DateTime.UtcNow,
        UpdatedBy = "system-seed",
    };
}
