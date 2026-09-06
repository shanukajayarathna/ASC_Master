namespace Asc.Api.Modules.LearningContent;

/// <summary>First-run seed so the Knowledge Base "Learn" carousel is never empty before an
/// Admin adds real content through the CMS panel — same "one-time migration data, not a
/// runtime mock" framing as LandingPageContentSeed. Module-guidance taglines are the exact,
/// already-vetted copy from each module's own nav.ts entry, not reworded. Tea-education
/// content is genuinely well-known, standard industry knowledge — no invented statistics —
/// and the elevation item ties directly to this app's own AuctionLot.ElevationCode field.
/// Every VideoUrl is left null ("walkthrough coming soon") since no real video assets exist
/// yet; images reuse already-licensed photos already vetted for this app
/// (public/tea/intro/ATTRIBUTION.md) rather than sourcing new ones for placeholder tiles.</summary>
public static class LearningContentSeed
{
    public static List<LearningContentItem> Default() =>
    [
        // ---- Module guidance ------------------------------------------------------------
        new()
        {
            Category = LearningContentCategory.ModuleGuidance,
            Title = "Catalogue Manager",
            Tagline = "Import weekly sale catalogues and browse every lot in the grid.",
            Body = "Import weekly sale catalogues and browse every lot in the grid.",
            // Same already-vetted Unsplash photo as this module's own dashboard tile
            // (nav.ts) — real, on-topic imagery rather than a fresh unvetted search hit.
            ImageUrl = "https://images.unsplash.com/photo-1602943543714-cf535b048440",
            VideoUrl = null,
            Order = 1,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.ModuleGuidance,
            Title = "Valuation Centre",
            Tagline = "Value and classify lots — list view or the tablet-friendly focus mode.",
            Body = "Value and classify lots — list view or the tablet-friendly focus mode.",
            ImageUrl = "https://images.unsplash.com/photo-1531967802777-e0f8fc276609",
            VideoUrl = null,
            Order = 2,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.ModuleGuidance,
            Title = "Reports",
            Tagline = "Executive, broker, grade and valuation summaries — ready to export.",
            Body = "Executive, broker, grade and valuation summaries — ready to export.",
            ImageUrl = "https://images.unsplash.com/photo-1554224155-1696413565d3",
            VideoUrl = null,
            Order = 3,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.ModuleGuidance,
            Title = "AI Assistant",
            Tagline = "Ask about lots, valuations and documents — grounded in this sale's data.",
            Body = "Ask about lots, valuations and documents — grounded in this sale's data.",
            ImageUrl = "https://images.unsplash.com/photo-1644088379091-d574269d422f",
            VideoUrl = null,
            Order = 4,
            AddedBy = "system-seed",
        },

        // ---- Tea education ---------------------------------------------------------------
        new()
        {
            Category = LearningContentCategory.TeaEducation,
            Title = "Orthodox vs. CTC Processing",
            Tagline = "Two ways a tea leaf becomes the tea in your cup.",
            Body = "Orthodox processing rolls and twists whole or broken leaves, preserving more " +
                   "of the leaf's original shape and producing a slower, more complex infusion. " +
                   "CTC (Crush-Tear-Curl) mechanically shreds the leaf into small, uniform granules " +
                   "— it brews faster and stronger, and is the style most common in tea bags. " +
                   "Neither is \"better\" — they're suited to different drinking styles.",
            ImageUrl = "/tea/intro/withering-troughs-damro.webp",
            VideoUrl = null,
            Order = 1,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.TeaEducation,
            Title = "Understanding Tea Grades",
            Tagline = "What BOP, BOPF, Dust, OP and Pekoe actually mean.",
            Body = "Tea grades describe leaf particle size, not quality. Whole-leaf grades like " +
                   "OP (Orange Pekoe) and Pekoe are the largest particles; broken grades like BOP " +
                   "(Broken Orange Pekoe) and BOPF (Broken Orange Pekoe Fannings) are smaller; " +
                   "Dust grades are the smallest, fastest-brewing particles, common in tea bags. " +
                   "Smaller particles generally infuse faster and stronger.",
            ImageUrl = "/tea/intro/ceylon-tea-grading-macro.webp",
            VideoUrl = null,
            Order = 2,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.TeaEducation,
            Title = "Reading a Liquor (Infusion)",
            Tagline = "The taster's vocabulary for a brewed cup.",
            Body = "\"Liquor\" is simply the brewed tea. Tasters assess it on colour (depth and " +
                   "clarity), briskness (a lively, sharp character rather than flat or dull), " +
                   "body (strength and fullness on the palate), and aroma. These same terms " +
                   "appear throughout this platform's lot remarks and classification fields.",
            ImageUrl = "/tea/intro/tea-cup-glass.webp",
            VideoUrl = null,
            Order = 3,
            AddedBy = "system-seed",
        },
        new()
        {
            Category = LearningContentCategory.TeaEducation,
            Title = "High, Medium & Low Grown",
            Tagline = "Ceylon tea's elevation classification, and why it matters.",
            Body = "Sri Lankan tea is classified by the elevation it's grown at: High Grown " +
                   "(above roughly 1,200m — Nuwara Eliya, Uva, Dimbula), Medium Grown, and Low " +
                   "Grown (closer to sea level — Ruhuna, Sabaragamuwa). Elevation strongly shapes " +
                   "flavour and is one of the core fields on every lot in this platform's auction " +
                   "archive (ElevationCode).",
            ImageUrl = "/tea/intro/estate-mist-hatton.webp",
            VideoUrl = null,
            Order = 4,
            AddedBy = "system-seed",
        },

        // ---- Articles ----------------------------------------------------------------------
        new()
        {
            Category = LearningContentCategory.Article,
            Title = "Getting Ready for Sale Week",
            Tagline = "A short checklist for the days before a sale.",
            Body = "1. Import the week's catalogue as soon as it's available, so parsing and " +
                   "any data-quality issues surface early. 2. Work through unvalued lots in " +
                   "Valuation Centre, using Sharings to see what other brokers are offering the " +
                   "same mark. 3. Run Category Analysis and the Weekly FACT reports once the " +
                   "catalogue looks complete, to catch anything unusual before the floor opens. " +
                   "4. Save any filter sets you'll want again as a Saved Filter.",
            ImageUrl = "/tea/intro/tea-sorting-grading-room.webp",
            VideoUrl = null,
            Order = 1,
            AddedBy = "system-seed",
        },
    ];
}
