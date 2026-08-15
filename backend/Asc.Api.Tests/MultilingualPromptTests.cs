using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

/// <summary>
/// Anchors the multilingual contract (docs/29): every agent must carry the shared language
/// instructions, so a user writing Sinhala/Tamil/Singlish/mixed gets the same language
/// behavior regardless of which capability answers. These tests pin the load-bearing parts
/// of that instruction text — if someone rewords it, they must consciously keep these
/// behaviors, not lose them in an edit.
/// </summary>
public class MultilingualPromptTests
{
    [Theory]
    [InlineData("Sinhala")]
    [InlineData("Tamil")]
    [InlineData("Singlish")]
    [InlineData("English")]
    public void LanguageInstructions_CoverEveryRequiredLanguage(string language)
    {
        Assert.Contains(language, GeneralAgent.LanguageInstructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void LanguageInstructions_RequireAutoDetection_NeverAskingForALanguage()
    {
        Assert.Contains("never ask the user to pick a language", GeneralAgent.LanguageInstructions);
    }

    [Fact]
    public void LanguageInstructions_RequireMirroringTheUsersLanguage()
    {
        Assert.Contains("Reply in the same language", GeneralAgent.LanguageInstructions);
    }

    [Fact]
    public void LanguageInstructions_KeepCodesAndFiguresUntranslated()
    {
        // Grades, lot numbers and Rs. amounts must survive every language unchanged.
        Assert.Contains("never translate or transliterate codes and figures", GeneralAgent.LanguageInstructions);
    }

    [Fact]
    public void LanguageInstructions_IncludeNativeScriptExamples()
    {
        // The instruction text itself carries Sinhala and Tamil script so the model sees the
        // scripts it must handle, not just their English names.
        Assert.Contains("සිංහල", GeneralAgent.LanguageInstructions);
        Assert.Contains("தமிழ்", GeneralAgent.LanguageInstructions);
    }
}
