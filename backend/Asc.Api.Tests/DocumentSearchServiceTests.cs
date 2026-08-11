using Asc.Api.Modules.Documents;

namespace Asc.Api.Tests;

public class DocumentSearchServiceTests
{
    private static readonly DateTime Now = new(2026, 8, 10, 12, 0, 0, DateTimeKind.Utc);

    private static KnowledgeDocument Doc(DateTime? effectiveDate = null, DateTime? expiryDate = null) => new()
    {
        FileName = "test.pdf",
        EffectiveDate = effectiveDate,
        ExpiryDate = expiryDate,
    };

    [Fact]
    public void IsCurrentlyVisible_SupersededDocument_IsHidden()
    {
        Assert.False(DocumentSearchService.IsCurrentlyVisible(Doc(), isSuperseded: true, Now));
    }

    [Fact]
    public void IsCurrentlyVisible_ExpiredDocument_IsHidden()
    {
        var doc = Doc(expiryDate: Now.AddDays(-1));
        Assert.False(DocumentSearchService.IsCurrentlyVisible(doc, isSuperseded: false, Now));
    }

    [Fact]
    public void IsCurrentlyVisible_NotYetEffectiveDocument_IsHidden()
    {
        var doc = Doc(effectiveDate: Now.AddDays(1));
        Assert.False(DocumentSearchService.IsCurrentlyVisible(doc, isSuperseded: false, Now));
    }

    [Fact]
    public void IsCurrentlyVisible_NoDatesAndNotSuperseded_IsVisible()
    {
        Assert.True(DocumentSearchService.IsCurrentlyVisible(Doc(), isSuperseded: false, Now));
    }

    [Fact]
    public void IsCurrentlyVisible_EffectiveInPastWithNoExpiry_IsVisible()
    {
        var doc = Doc(effectiveDate: Now.AddYears(-1));
        Assert.True(DocumentSearchService.IsCurrentlyVisible(doc, isSuperseded: false, Now));
    }

    [Fact]
    public void IsCurrentlyVisible_WithinEffectiveWindow_IsVisible()
    {
        var doc = Doc(effectiveDate: Now.AddDays(-1), expiryDate: Now.AddDays(1));
        Assert.True(DocumentSearchService.IsCurrentlyVisible(doc, isSuperseded: false, Now));
    }
}
