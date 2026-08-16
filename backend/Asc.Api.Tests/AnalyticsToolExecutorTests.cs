using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class AnalyticsToolExecutorTests
{
    // ---- ResolveBroker — pure, shared by get_sale_breakdown's broker scoping and
    // scan_mark_performance; both used to duplicate this lookup inline. ----

    [Theory]
    [InlineData("ASC", "AS")]
    [InlineData("asc", "AS")] // case-insensitive
    [InlineData(" FW ", "FBS")] // surrounding whitespace tolerated
    [InlineData("BC", "BTL")]
    [InlineData("CT", "DES")]
    [InlineData("JK", "JK")]
    [InlineData("MPB", "MB")]
    [InlineData("EB", "EB")]
    [InlineData("LC", "LCB")]
    public void ResolveBroker_KnownShortCode_ResolvesToMslCode(string input, string expectedMsl)
    {
        var (_, msl) = AnalyticsToolExecutor.ResolveBroker(input);
        Assert.Equal(expectedMsl, msl);
    }

    [Fact]
    public void ResolveBroker_RawMslCode_AlsoResolves()
    {
        // A model that echoes the raw MSL code instead of the short code must still work.
        var (_, msl) = AnalyticsToolExecutor.ResolveBroker("AS");
        Assert.Equal("AS", msl);
    }

    [Fact]
    public void ResolveBroker_UnknownCode_ReturnsNullMsl()
    {
        var (code, msl) = AnalyticsToolExecutor.ResolveBroker("NOPE");
        Assert.Equal("NOPE", code);
        Assert.Null(msl);
    }

    // ---- NormalizeMarkPrefix — guards mark_history/mark_broker_history against a blank or
    // near-blank argument turning "^" + regex into a full 6.9M-row collection match. ----

    [Fact]
    public void NormalizeMarkPrefix_EmptyString_RejectedAsNull()
    {
        Assert.Null(AnalyticsToolExecutor.NormalizeMarkPrefix(""));
    }

    [Fact]
    public void NormalizeMarkPrefix_WhitespaceOnly_RejectedAsNull()
    {
        Assert.Null(AnalyticsToolExecutor.NormalizeMarkPrefix("   "));
    }

    [Fact]
    public void NormalizeMarkPrefix_SingleCharacter_RejectedAsNull()
    {
        Assert.Null(AnalyticsToolExecutor.NormalizeMarkPrefix("C"));
    }

    [Fact]
    public void NormalizeMarkPrefix_ValidMark_UppercasedAndTrimmed()
    {
        Assert.Equal("CEYENTA", AnalyticsToolExecutor.NormalizeMarkPrefix("  ceyenta  "));
    }

    [Fact]
    public void NormalizeMarkPrefix_TwoCharacters_Accepted()
    {
        // Exactly at the boundary — must not be rejected.
        Assert.Equal("CY", AnalyticsToolExecutor.NormalizeMarkPrefix("cy"));
    }

    // ---- scan_mark_performance tool definition — the advertised schema IS the enforcement
    // mechanism (a chat-completions API can only send a mode the schema documents). ----

    [Fact]
    public void Definitions_IncludesScanMarkPerformance()
    {
        Assert.Contains(AnalyticsToolExecutor.DefinitionsFor(false), d => d.Name == "scan_mark_performance");
    }

    [Fact]
    public void ScanMarkPerformance_DescriptionMentionsAtRiskMode()
    {
        // at_risk is the churn/early-warning counterpart to recruit_leads (same underlying
        // data, opposite sort) — the model can only pick it if the tool's own description
        // names it, since that's the only place mode values are documented to the LLM.
        var tool = AnalyticsToolExecutor.DefinitionsFor(false).Single(d => d.Name == "scan_mark_performance");
        Assert.Contains("at_risk", tool.Description);
    }

    // ---- mark_broker_history — confirm it's still advertised after this session's edits ----

    [Fact]
    public void Definitions_IncludesMarkBrokerHistory()
    {
        Assert.Contains(AnalyticsToolExecutor.DefinitionsFor(false), d => d.Name == "mark_broker_history");
    }

    // ---- generate_pdf / generate_presentation — the deck/print counterparts to generate_excel ----

    [Fact]
    public void Definitions_IncludesPdfAndPresentationExports()
    {
        var names = AnalyticsToolExecutor.DefinitionsFor(false).Select(d => d.Name).ToList();
        Assert.Contains("generate_pdf", names);
        Assert.Contains("generate_presentation", names);
        Assert.Contains("generate_excel", names); // the pre-existing sibling must still be there
    }
}
