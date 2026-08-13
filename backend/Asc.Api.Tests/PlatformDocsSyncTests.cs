using Asc.Api.Modules.Documents;

namespace Asc.Api.Tests;

public class PlatformDocsSyncTests
{
    // ---- deterministic identity: what makes re-syncs replace instead of duplicate ----

    [Fact]
    public void DocumentIdFor_SameFileName_SameId()
    {
        Assert.Equal(
            PlatformDocsSyncService.DocumentIdFor("08_AI_Assistant.md"),
            PlatformDocsSyncService.DocumentIdFor("08_AI_Assistant.md"));
    }

    [Fact]
    public void DocumentIdFor_IsCaseInsensitive()
    {
        // A rename that only changes casing must not orphan the previously synced document.
        Assert.Equal(
            PlatformDocsSyncService.DocumentIdFor("README.md"),
            PlatformDocsSyncService.DocumentIdFor("readme.MD"));
    }

    [Fact]
    public void DocumentIdFor_DifferentFiles_DifferentIds()
    {
        Assert.NotEqual(
            PlatformDocsSyncService.DocumentIdFor("08_AI_Assistant.md"),
            PlatformDocsSyncService.DocumentIdFor("09_Catalogue_Manager.md"));
    }

    // ---- change detection: what makes an unchanged re-sync free ----

    [Fact]
    public void ContentHashOf_SameText_SameHash()
    {
        Assert.Equal(
            PlatformDocsSyncService.ContentHashOf("# Valuation Centre\nSome content."),
            PlatformDocsSyncService.ContentHashOf("# Valuation Centre\nSome content."));
    }

    [Fact]
    public void ContentHashOf_EditedText_DifferentHash()
    {
        Assert.NotEqual(
            PlatformDocsSyncService.ContentHashOf("# Valuation Centre\nSome content."),
            PlatformDocsSyncService.ContentHashOf("# Valuation Centre\nSome content, revised."));
    }

    // ---- the synced docs must be visible to the existing search pipeline ----

    [Fact]
    public void SyncedDocumentShape_IsCurrentlyVisible()
    {
        // The service writes docs with no effective/expiry window and no superseding —
        // exactly the shape DocumentSearchService treats as always-visible. If either
        // side changes, platform docs would silently vanish from search.
        var doc = new KnowledgeDocument
        {
            Id = PlatformDocsSyncService.DocumentIdFor("15_Knowledge_Base.md"),
            FileName = "15_Knowledge_Base.md",
            Category = DocumentCategory.Reference,
            ContentHash = PlatformDocsSyncService.ContentHashOf("content"),
        };
        Assert.True(DocumentSearchService.IsCurrentlyVisible(doc, isSuperseded: false, DateTime.UtcNow));
    }
}
