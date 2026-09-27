using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class FactoryAverageToolsTests
{
    [Fact]
    public void AnalyticsAgent_OffersBothFactoryTools()
    {
        var names = AnalyticsToolExecutor.DefinitionsFor(false).Select(d => d.Name).ToList();
        Assert.Contains(FactoryAverageTools.TableTool, names);
        Assert.Contains(FactoryAverageTools.HistoryTool, names);
        Assert.Contains("list_sales", names); // the existing tools are untouched
    }

    [Theory]
    [InlineData("get_factory_averages", true)]
    [InlineData("factory_history", true)]
    [InlineData("get_teaboard_averages", false)]
    [InlineData("query_data", false)]
    public void IsFactoryTool_OnlyClaimsItsOwnTools(string name, bool expected) =>
        Assert.Equal(expected, FactoryAverageTools.IsFactoryTool(name));

    [Fact]
    public void FactoryHistory_RequiresAFactory_AndTableToolRequiresNothing()
    {
        var history = FactoryAverageTools.Definitions.Single(d => d.Name == FactoryAverageTools.HistoryTool);
        var table = FactoryAverageTools.Definitions.Single(d => d.Name == FactoryAverageTools.TableTool);
        Assert.Contains("\"required\"", System.Text.Json.JsonSerializer.Serialize(history.ParametersSchema));
        Assert.DoesNotContain("\"required\"", System.Text.Json.JsonSerializer.Serialize(table.ParametersSchema));
    }

    [Fact]
    public void FactoryToolResults_AreAttributedToTheArchive()
    {
        var sources = SourceTracker.SourcesFor([
            (FactoryAverageTools.TableTool, "{}", "{\"scope\":\"Factory Wise Averages\"}"),
            (FactoryAverageTools.HistoryTool, "{}", "{\"scope\":\"x\"}"),
        ]);
        var only = Assert.Single(sources); // both tools collapse into one source chip
        Assert.Equal("archive", only.Kind);
    }
}
