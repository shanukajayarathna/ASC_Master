using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Knowledge;
using Asc.Api.Modules.Observability;

namespace Asc.Api.Tests;

public class SourceTrackerTests
{
    private const string BylawsHit = "{\"matchedSections\":[\"Default penalties\"],\"sections\":[]}";

    [Fact]
    public void SourcesFor_MapsToolsToWhereTheirFiguresCameFrom()
    {
        var sources = SourceTracker.SourcesFor([
            ("get_ctta_bylaws", "{}", BylawsHit),
            ("query_data", "{}", "{\"datasetId\":\"x\"}"),
            ("list_sales", "{}", "[]"),                    // also the archive: not listed twice
            ("search_lots", "{}", "{\"lots\":[]}"),
            ("get_saved_report", "{}", "{}"),
            ("generate_excel", "{}", "{\"link\":\"x\"}"),
        ]);

        Assert.Equal(
            [new ChatSource("bylaws", "CTTA By-Laws", "Default penalties"), new ChatSource("archive", "MSL auction archive"),
             new ChatSource("catalogue", "Sale catalogue data"), new ChatSource("saved", "Saved reports"), new ChatSource("file", "Generated file")],
            sources);
    }

    [Fact]
    public void SourcesFor_IgnoresToolsThatFailed()
    {
        var sources = SourceTracker.SourcesFor([("query_data", "{}", "{\"error\":\"nope\"}"), ("search_lots", "{}", "  {\"error\":\"x\"}")]);
        Assert.Empty(sources);
    }

    [Fact]
    public void SourcesFor_ABylawsCallWithNoMatchedSectionCitesTheByLawsWithoutOne()
    {
        var sources = SourceTracker.SourcesFor([("get_ctta_bylaws", "{}", "{\"matchedSections\":[],\"sections\":[]}")]);
        Assert.Equal([new ChatSource("bylaws", "CTTA By-Laws", null)], sources);
        Assert.Null(SourceTracker.FirstMatchedSection("not json"));
    }

    [Fact]
    public async Task Wrap_RecordsEveryCallAndPassesResultsThrough()
    {
        var tracker = new SourceTracker();
        var wrapped = tracker.Wrap((name, args) => Task.FromResult(name == "boom" ? "{\"error\":\"x\"}" : "{}"));

        Assert.Equal("{}", await wrapped("search_lots", "{}"));
        await wrapped("boom", "{}");
        await wrapped("query_data", "{}");

        Assert.Equal([new ChatSource("catalogue", "Sale catalogue data"), new ChatSource("archive", "MSL auction archive")], tracker.ToSources());
    }

    // ---- by-laws clause picking

    private static CttaBylawsLookupResult Result(params string[] matched) => new(
        "2026-01-01", "caveat",
        [new CttaBylawsSection("Key Constants", "10%"), new CttaBylawsSection("Default penalties", "1%/day"), new CttaBylawsSection("Other", "x")],
        matched, ["Default penalties", "Other"]);

    [Fact]
    public void Pick_ReturnsOnlyAMatchedSectionByTitle_NeverTheConstantsPreamble()
    {
        Assert.Equal("1%/day", CttaBylawsController.Pick(Result("Default penalties"), "default PENALTIES")!.Text);
        Assert.Null(CttaBylawsController.Pick(Result("Default penalties"), "Other")); // exists but was not matched
        Assert.Null(CttaBylawsController.Pick(Result(), "Key Constants"));
    }

    // ---- usage by agent

    [Fact]
    public void SummariseByAgent_GroupsCallsTokensAndCostPerAgent()
    {
        AiUsageLogEntry E(string? agent, int p, int c, bool ok, decimal? cost) => new() { AgentKey = agent, PromptTokens = p, CompletionTokens = c, Success = ok, EstimatedCostUsd = cost };
        var rows = ObservabilityController.SummariseByAgent([
            E("reports", 100, 50, true, 0.01m), E("reports", 10, 5, false, 0.02m), E("general", 1, 1, true, null), E(null, 5, 5, true, null),
        ]);

        var reports = rows.Single(r => r.Agent == "reports");
        Assert.Equal((2L, 1L, 110L, 55L), (reports.CallCount, reports.FailureCount, reports.PromptTokens, reports.CompletionTokens));
        Assert.Equal(0.03m, reports.EstimatedCostUsd);
        Assert.Null(rows.Single(r => r.Agent == "general").EstimatedCostUsd); // unpriced model stays unknown, not zero
        Assert.Contains(rows, r => r.Agent is null);
        Assert.Equal("reports", rows[0].Agent); // most calls first
    }

    [Fact]
    public void AiUsageScope_FlowsAndRestores()
    {
        Assert.Null(AiUsageScope.Current);
        using (AiUsageScope.Begin("auction"))
        {
            Assert.Equal("auction", AiUsageScope.Current);
            using (AiUsageScope.Begin("reports")) Assert.Equal("reports", AiUsageScope.Current);
            Assert.Equal("auction", AiUsageScope.Current);
        }
        Assert.Null(AiUsageScope.Current);
    }
}
