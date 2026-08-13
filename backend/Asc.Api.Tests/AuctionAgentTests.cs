using Asc.Api.Models;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class AuctionAgentTests
{
    // ---- AuctionAgent metadata (no gateway/tools call — same pattern the project already
    // uses for testing a type's own properties without exercising injected dependencies) ----

    [Fact]
    public void Key_IsAuction()
    {
        var agent = new AuctionAgent(null!, null!);
        Assert.Equal("auction", agent.Key);
    }

    [Fact]
    public void Capabilities_DescribeAuctionAnalysisOnly()
    {
        var agent = new AuctionAgent(null!, null!);

        Assert.Contains("auction-analysis", agent.Capabilities);
        // Not general-purpose: must not claim GeneralAgent's document/knowledge capability.
        Assert.DoesNotContain("documents", agent.Capabilities);
    }

    [Fact]
    public void Description_MentionsAuctionSpecialization()
    {
        var agent = new AuctionAgent(null!, null!);
        Assert.Contains("auction", agent.Description, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Tool access boundary — the advertised Definitions list IS the enforcement
    // mechanism (a chat-completions API can only call a tool it was told about) ----

    [Fact]
    public void Definitions_IncludesReusedCatalogueTools()
    {
        var names = AuctionToolExecutor.Definitions.Select(d => d.Name).ToList();

        Assert.Contains("list_catalogues", names);
        Assert.Contains("search_lots", names);
        Assert.Contains("get_dashboard_stats", names);
        Assert.Contains("compare_sales", names);
        Assert.Contains("get_broker_performance", names);
        Assert.Contains("get_breakdown", names);
        Assert.Contains("get_top_prices", names);
        Assert.Contains("get_performance_insights", names);
    }

    [Fact]
    public void Definitions_IncludesNewGetTopLotsTool()
    {
        Assert.Contains(AuctionToolExecutor.Definitions, d => d.Name == "get_top_lots");
    }

    [Fact]
    public void Definitions_ExcludesNonAuctionTools()
    {
        var names = AuctionToolExecutor.Definitions.Select(d => d.Name).ToList();

        // Document search and deadline tracking are not auction analysis.
        Assert.DoesNotContain("search_knowledge_base", names);
        Assert.DoesNotContain("get_upcoming_deadlines", names);
        // Valuation-accuracy / market-intelligence tools are a future MarketAgent's territory.
        Assert.DoesNotContain("get_valuation_accuracy", names);
        Assert.DoesNotContain("get_market_insights", names);
        // generate_report stays GeneralAgent-only for this milestone — dashboard/breakdown/top-prices
        // already cover a meaningful first AuctionAgent without it.
        Assert.DoesNotContain("generate_report", names);
    }

    [Fact]
    public void GeneralAgentToolSet_IsUnchangedByAuctionAgentExisting()
    {
        // AssistantToolExecutor.Definitions (GeneralAgent's tool set) must still be exactly
        // the original 13 tool names — AuctionAgent must not have expanded or altered it as
        // a side effect of reusing 8 of them.
        string[] expected =
        [
            "list_catalogues", "search_lots", "get_dashboard_stats", "search_knowledge_base",
            "compare_sales", "get_valuation_accuracy", "get_broker_performance", "get_market_insights",
            "get_breakdown", "get_top_prices", "generate_report", "get_performance_insights",
            "get_upcoming_deadlines",
        ];

        Assert.Equal(expected, Asc.Api.Modules.Assistant.AssistantToolExecutor.Definitions.Select(d => d.Name));
    }

    // ---- ComputeTopLots — the one genuinely new tool, pure and independently testable ----

    private static Lot Priced(string lotNumber, decimal price, string broker = "ABC", string grade = "BOP") =>
        new() { LotNumber = lotNumber, Broker = broker, Grade = grade, PurchasedPrice = price };

    [Fact]
    public void ComputeTopLots_RanksByPurchasedPriceDescending()
    {
        var lots = new List<Lot> { Priced("1", 100m), Priced("2", 300m), Priced("3", 200m) };

        var result = AuctionToolExecutor.ComputeTopLots(lots, 10);

        Assert.Equal(["2", "3", "1"], result.Rows.Select(r => r.LotNumber));
    }

    [Fact]
    public void ComputeTopLots_ExcludesLotsWithNoPurchasedPrice()
    {
        var lots = new List<Lot> { Priced("1", 100m), new() { LotNumber = "2", PurchasedPrice = null } };

        var result = AuctionToolExecutor.ComputeTopLots(lots, 10);

        Assert.Single(result.Rows);
        Assert.Equal("1", result.Rows[0].LotNumber);
        Assert.Equal(1, result.PricedLotCount);
        Assert.Equal(2, result.TotalLotCount);
    }

    [Fact]
    public void ComputeTopLots_EmptyCatalogue_ReturnsEmptyNotError()
    {
        var result = AuctionToolExecutor.ComputeTopLots([], 10);

        Assert.Empty(result.Rows);
        Assert.Equal(0, result.PricedLotCount);
        Assert.Equal(0, result.TotalLotCount);
    }

    [Fact]
    public void ComputeTopLots_NBelowOne_ClampsToOne()
    {
        var lots = new List<Lot> { Priced("1", 100m), Priced("2", 200m) };

        var result = AuctionToolExecutor.ComputeTopLots(lots, 0);

        Assert.Single(result.Rows);
        Assert.Equal("2", result.Rows[0].LotNumber);
    }

    [Fact]
    public void ComputeTopLots_NAboveMax_ClampsToFifty()
    {
        var lots = Enumerable.Range(1, 60).Select(i => Priced(i.ToString(), i)).ToList();

        var result = AuctionToolExecutor.ComputeTopLots(lots, 1000);

        Assert.Equal(50, result.Rows.Count);
        Assert.Equal("60", result.Rows[0].LotNumber); // highest price first
    }

    [Fact]
    public void ComputeTopLots_NeverMutatesInputList()
    {
        var lots = new List<Lot> { Priced("1", 100m), Priced("2", 300m) };
        var originalOrder = lots.Select(l => l.LotNumber).ToList();

        AuctionToolExecutor.ComputeTopLots(lots, 10);

        Assert.Equal(originalOrder, lots.Select(l => l.LotNumber));
    }
}
