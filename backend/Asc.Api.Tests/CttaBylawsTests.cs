using System.Text.Json;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Knowledge;
using Microsoft.Extensions.Logging.Abstractions;

namespace Asc.Api.Tests;

public class CttaBylawsTests
{
    // The real canonical file, not a fixture — these tests are what catch an edit to
    // docs/ctta-bylaws-knowledge-base.md that breaks section routing or drops a constant.
    private static readonly Lazy<string> RealDoc = new(() =>
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, "docs", CttaBylawsService.FileName);
            if (File.Exists(path)) return File.ReadAllText(path);
        }
        throw new FileNotFoundException($"docs/{CttaBylawsService.FileName} not found above {AppContext.BaseDirectory}");
    });

    private static CttaBylawsService.ParsedDoc Parsed() => CttaBylawsService.Parse(RealDoc.Value);

    // ---- parsing ----

    [Fact]
    public void Parse_RealDoc_FindsAllSixteenSectionsInOrder()
    {
        var titles = Parsed().Sections.Select(s => s.Title).ToList();

        Assert.Equal(16, titles.Count);
        Assert.Equal("Key Constants (quick reference)", titles[0]);
        Assert.Equal("Electronic Delivery Order (EDO) Registration (Annexure IV, process summary)", titles[^1]);
    }

    [Fact]
    public void Parse_RealDoc_ReadsLastVerifiedDate()
    {
        Assert.Equal("2026-09-14", Parsed().LastVerified);
    }

    [Fact]
    public void Parse_KeepsSubsectionsInsideTheirSection()
    {
        var payment = Parsed().Sections.Single(s => s.Title == "Payment & Deposits");

        Assert.Contains("### Buyer/Co-Buyer default cascade", payment.Text);
        Assert.Contains("### Broker payment-to-Seller default cascade", payment.Text);
    }

    [Fact]
    public void Parse_StopsSectionAtHorizontalRule()
    {
        var doc = CttaBylawsService.Parse("# T\n\n## 1. First\nbody one\n\n---\n\n*footnote*");

        Assert.Equal("body one", Assert.Single(doc.Sections).Text);
    }

    // ---- routing: the Phase 3 validation questions must reach the section holding the answer ----

    [Theory]
    [InlineData("What's the buyer's deposit percentage and when is it due?", "Payment & Deposits")]
    [InlineData("What happens if a buyer defaults on payment for the third time?", "Payment & Deposits")]
    [InlineData("How much can I be charged for storage after 60 days?", "Risk & Storage (Colombo warehouses)")]
    [InlineData("What's the minimum quality standard for teas offered at auction?", "Teas Offered & Quality Standard")]
    [InlineData("How long does a buyer have to file a quality complaint?", "Objections, Complaints & Claims")]
    [InlineData("rate of advancing bids", "Auction Procedure")]
    [InlineData("ex-estate delivery deadline", "Delivery")]
    public void Match_RoutesQuestionToAnsweringSection(string question, string expectedTitle)
    {
        var matched = CttaBylawsService.Match(Parsed().Sections, question);

        Assert.NotEmpty(matched);
        Assert.Equal(expectedTitle, matched[0].Title);
    }

    [Fact]
    public void Match_OnlyStopWords_ReturnsNothing()
    {
        Assert.Empty(CttaBylawsService.Match(Parsed().Sections, "what is the"));
        Assert.Empty(CttaBylawsService.Match(Parsed().Sections, null));
    }

    [Fact]
    public void Match_NeverReturnsKeyConstants()
    {
        var matched = CttaBylawsService.Match(Parsed().Sections, "key constants quick reference");

        Assert.DoesNotContain(matched, s => s.Title == CttaBylawsService.KeyConstantsTitle);
    }

    // ---- result shape: load-bearing numbers always travel with the answer ----

    [Fact]
    public void BuildResult_KeyConstantsFirst_ThenMatchedSection()
    {
        var result = CttaBylawsService.BuildResult(Parsed(), "storage charges");

        Assert.Equal(CttaBylawsService.KeyConstantsTitle, result.Sections[0].Title);
        Assert.Equal("Risk & Storage (Colombo warehouses)", result.MatchedSections[0]);
        Assert.Equal(16, result.AvailableSections.Count);
    }

    [Fact]
    public void BuildResult_UnmatchedTopic_StillCarriesKeyConstantsAndCaveat()
    {
        var result = CttaBylawsService.BuildResult(Parsed(), "zzqx");

        Assert.Empty(result.MatchedSections);
        Assert.Single(result.Sections);
        Assert.Contains("3 months", result.Caveat);
        Assert.Contains("suspend", result.Caveat);
    }

    [Theory]
    [InlineData("10% of lot value, due by 2:00 p.m. two working days after the final day of auction")]
    [InlineData("6 days after conclusion of sale (excluding public/bank/mercantile holidays), by 1:00 p.m.")]
    [InlineData("AWPLR (Average Weighted Prime Lending Rate) + 4%")]
    [InlineData("Rs. 3.25 per package per day")]
    [InlineData("Rs. 10.40 per package per day")]
    [InlineData("51 calendar days from date of auction/sale")]
    [InlineData("ISO Std. 3720")]
    public void KeyConstants_ContainsReferenceFiguresVerbatim(string figure)
    {
        var keyConstants = Parsed().Sections.Single(s => s.Title == CttaBylawsService.KeyConstantsTitle);

        Assert.Contains(figure, keyConstants.Text);
    }

    // ---- tool wiring: additive, never alters an executor's own tool set ----

    [Fact]
    public void WithDefinition_AppendsOnce_AndLeavesSourceListUntouched()
    {
        var tool = new CttaBylawsTool(new MissingBylaws(), NullLogger<CttaBylawsTool>.Instance);
        var before = AssistantToolExecutor.Definitions.Count;

        var once = CttaBylawsTool.WithDefinition(tool, AssistantToolExecutor.Definitions);
        var twice = CttaBylawsTool.WithDefinition(tool, once);

        Assert.Equal(before + 1, once.Count);
        Assert.Equal(once.Count, twice.Count);
        Assert.Equal(before, AssistantToolExecutor.Definitions.Count);
        Assert.DoesNotContain(AuctionToolExecutor.Definitions, d => d.Name == CttaBylawsTool.Name);
        Assert.DoesNotContain(ReportsToolExecutor.Definitions, d => d.Name == CttaBylawsTool.Name);
    }

    [Fact]
    public void WithoutRegisteredTool_AgentSurfaceIsUnchanged()
    {
        Assert.Same(AssistantToolExecutor.Definitions, CttaBylawsTool.WithDefinition(null, AssistantToolExecutor.Definitions));
        Assert.Equal("", CttaBylawsTool.PromptFor(null));
    }

    [Fact]
    public async Task Dispatch_RoutesOnlyBylawsToolAway_FromInnerExecutor()
    {
        var tool = new CttaBylawsTool(new MissingBylaws(), NullLogger<CttaBylawsTool>.Instance);
        var dispatch = CttaBylawsTool.Dispatch(tool, (name, _) => Task.FromResult($"inner:{name}"));

        Assert.Equal("inner:search_lots", await dispatch("search_lots", "{}"));
        Assert.Contains("isn't available", await dispatch(CttaBylawsTool.Name, "{\"topic\":\"deposit\"}"));
    }

    [Fact]
    public void Execute_ReturnsSectionsCaveatAndUnescapedFigures()
    {
        var tool = new CttaBylawsTool(new RealDocBylaws(), NullLogger<CttaBylawsTool>.Instance);

        var json = tool.Execute("{\"topic\":\"rate of advancing bids\"}");
        using var parsed = JsonDocument.Parse(json);
        var root = parsed.RootElement;

        Assert.Equal("2026-09-14", root.GetProperty("lastVerified").GetString());
        Assert.Contains("3 months", root.GetProperty("caveat").GetString());
        Assert.Equal("Auction Procedure", root.GetProperty("matchedSections")[0].GetString());
        Assert.Contains("≤ 200", json); // relaxed escaping — not ≤
    }

    [Fact]
    public void Execute_MalformedArguments_ReturnsKeyConstantsNotException()
    {
        var tool = new CttaBylawsTool(new RealDocBylaws(), NullLogger<CttaBylawsTool>.Instance);

        using var parsed = JsonDocument.Parse(tool.Execute("null"));

        Assert.Equal(0, parsed.RootElement.GetProperty("matchedSections").GetArrayLength());
        Assert.Equal(1, parsed.RootElement.GetProperty("sections").GetArrayLength());
    }

    private sealed class MissingBylaws : ICttaBylawsService
    {
        public CttaBylawsLookupResult? Lookup(string? topic) => null;
    }

    private sealed class RealDocBylaws : ICttaBylawsService
    {
        public CttaBylawsLookupResult? Lookup(string? topic) => CttaBylawsService.BuildResult(Parsed(), topic);
    }
}
