using System.Text.Json.Nodes;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Msl;
using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class ArchiveScopeTests
{
    // ---- the scope itself

    [Fact]
    public void Validate_AcceptsASaleARangeAndWholeYears_AndRefusesNonsense()
    {
        Assert.Null(new ArchiveScope(2026, 32, 2026, 32).Validate());
        Assert.Null(new ArchiveScope(2025, 40, 2026, 5).Validate());   // across a year boundary
        Assert.Null(new ArchiveScope(2024, null, 2026, null).Validate());
        Assert.NotNull(new ArchiveScope(2026, 30, 2026, 10).Validate()); // ends before it starts
        Assert.NotNull(new ArchiveScope(2026, 0, 2026, 5).Validate());
        Assert.NotNull(new ArchiveScope(1999, null, 2026, null).Validate());
        Assert.NotNull(new ArchiveScope(2020, null, 2026, null).Validate()); // more than three years
    }

    [Fact]
    public void Contains_PairsSaleNumbersWithTheRightYear()
    {
        var s = new ArchiveScope(2025, 50, 2026, 3);
        Assert.True(s.Contains(2025, 50));
        Assert.True(s.Contains(2025, 51));
        Assert.True(s.Contains(2026, 1));
        Assert.True(s.Contains(2026, 3));
        Assert.False(s.Contains(2025, 49));
        Assert.False(s.Contains(2026, 4));
        Assert.False(s.Contains(2025, 3));   // sale 3 of 2025 is not sale 3 of 2026
        Assert.True(new ArchiveScope(2026, null, 2026, null).Contains(2026, 39));
        Assert.False(new ArchiveScope(2026, null, 2026, null).Contains(2025, 39));
    }

    [Fact]
    public void Describe_ReadsLikeAPerson()
    {
        Assert.Equal("sale 32/2026", new ArchiveScope(2026, 32, 2026, 32).Describe());
        Assert.Equal("sales 28/2026–32/2026", new ArchiveScope(2026, 28, 2026, 32).Describe());
        Assert.Equal("the whole of 2026", new ArchiveScope(2026, null, 2026, null).Describe());
        Assert.Equal("the years 2025–2026", new ArchiveScope(2025, null, 2026, null).Describe());
    }

    [Fact]
    public void PromptLine_IsEmptyWithoutAScope_AndNamesThePeriodWithOne()
    {
        Assert.Equal("", ArchiveScope.PromptLine(null));
        Assert.Contains("sale 32/2026", ArchiveScope.PromptLine(new ArchiveScope(2026, 32, 2026, 32)));
    }

    // ---- making sure a forgetful model cannot leave the scope

    [Fact]
    public void ApplyToToolCall_FillsInAQueryThatNamedNoPeriod()
    {
        var scope = new ArchiveScope(2026, 28, 2026, 32);
        var args = JsonNode.Parse(ArchiveScope.ApplyToToolCall("query_data", "{\"group_by\":\"broker\"}", scope))!;

        Assert.Equal("broker", args["group_by"]!.ToString());
        Assert.Equal((2026, 28, 2026, 32), (args["from_year"]!.GetValue<int>(), args["from_sale"]!.GetValue<int>(), args["to_year"]!.GetValue<int>(), args["to_sale"]!.GetValue<int>()));
    }

    [Fact]
    public void ApplyToToolCall_LeavesExplicitPeriodsOtherToolsAndNoScopeAlone()
    {
        var scope = new ArchiveScope(2026, 28, 2026, 32);
        const string explicitYears = "{\"group_by\":\"broker\",\"years\":[2025]}";
        const string explicitLast = "{\"group_by\":\"broker\",\"last_n_sales\":4}";
        Assert.Equal(explicitYears, ArchiveScope.ApplyToToolCall("query_data", explicitYears, scope));
        Assert.Equal(explicitLast, ArchiveScope.ApplyToToolCall("query_data", explicitLast, scope));
        Assert.Equal("{\"x\":1}", ArchiveScope.ApplyToToolCall("list_sales", "{\"x\":1}", scope));
        Assert.Equal("{\"group_by\":\"broker\"}", ArchiveScope.ApplyToToolCall("query_data", "{\"group_by\":\"broker\"}", null));
        Assert.Equal("not json", ArchiveScope.ApplyToToolCall("query_data", "not json", scope));
    }

    [Fact]
    public void ParseRange_ReadsTheArgumentsAndReportsABadOne()
    {
        var ok = CustomReportLogic.ParseRange(JsonNode.Parse("{\"from_year\":2025,\"from_sale\":40,\"to_year\":2026,\"to_sale\":5}")!, out var e1);
        Assert.Null(e1);
        Assert.Equal(new ArchiveScope(2025, 40, 2026, 5), ok);
        Assert.Equal(new ArchiveScope(2026, null, 2026, null), CustomReportLogic.ParseRange(JsonNode.Parse("{\"from_year\":2026,\"to_year\":2026}")!, out _));
        Assert.Null(CustomReportLogic.ParseRange(JsonNode.Parse("{\"group_by\":\"broker\"}")!, out var none));
        Assert.Null(none);
        Assert.Null(CustomReportLogic.ParseRange(JsonNode.Parse("{\"from_year\":2026,\"from_sale\":9,\"to_year\":2026,\"to_sale\":2}")!, out var bad));
        Assert.NotNull(bad);
    }

    // ---- share of a broker's own volume

    private static FilteredSectionRow Row(string key, decimal qty) => new(key, null, 1, 1, qty, qty, qty * 100, 100, null);

    [Fact]
    public void ShareRows_IsEachBrokersQuantityOverItsOwnTotal()
    {
        // ASC offered 1,000 kg of which 300 off-grade (30%); FW offered 4,000 of which 400 (10%): FW has more tonnes
        // off-grade but ASC has a far higher SHARE.
        var share = CustomReportLogic.ShareRows([Row("AS", 300), Row("FBS", 400)], [Row("AS", 1000), Row("FBS", 4000)]);

        Assert.Equal(30m, share.Single(r => r.Key == "AS").TotalQtyKg);
        Assert.Equal(10m, share.Single(r => r.Key == "FBS").TotalQtyKg);
    }

    [Fact]
    public void ShareRows_DropsABrokerWithNoTotalVolume()
    {
        var share = CustomReportLogic.ShareRows([Row("AS", 5), Row("XX", 5)], [Row("AS", 50), Row("XX", 0)]);
        Assert.Equal(["AS"], share.Select(r => r.Key));
        Assert.Empty(CustomReportLogic.ShareRows([Row("AS", 5)], []));
    }

    [Fact]
    public void ShareOfMergedSales_IsNotTheMeanOfPerSalePercentages()
    {
        // Sale A: 100 of 1,000 (10%). Sale B: 100 of 100 (100%). Together 200 of 1,100 = 18.2%, not the mean (55%).
        var merged = CustomReportLogic.MergeRows([[Row("AS", 100)], [Row("AS", 100)]]);
        var totals = CustomReportLogic.MergeRows([[Row("AS", 1000)], [Row("AS", 100)]]);

        var share = CustomReportLogic.ShareRows(merged, totals).Single().TotalQtyKg;

        Assert.InRange(share, 18.1m, 18.2m);
    }

    [Fact]
    public void OwnVolumeFilter_KeepsThePeriodAndBrokersAndDropsEveryNarrowingFilter()
    {
        var f = new MslAnalyticsFilter([2026], [30], null, null, ["AS"], ["High"], ["BOPF"], ["Off Grade"], ["Off Grade"], ["CTC"], ["Orthodox"],
            ["Buyer"], ["MARK"], ["F1"], ["Type"], ["Group"], "public", "sold", "only", 1, 2, "m", "b", ["1"], ["I"], [10], [50m], ["D"], "asc", "organic");

        var own = CustomReportLogic.OwnVolumeFilter(f);

        Assert.Equal([2026], own.Years);
        Assert.Equal([30], own.SaleNos);
        Assert.Equal(["AS"], own.Brokers);
        Assert.Equal("public", own.SaleType);
        Assert.Null(own.Categories);
        Assert.Null(own.GradeTypes);
        Assert.Null(own.Grades);
        Assert.Null(own.Marks);
        Assert.Null(own.SoldStatus);
        Assert.Null(own.PriceMin);
        Assert.Contains("share_of_own_volume_pct", CustomReportLogic.Metrics.Keys);
    }

    // ---- what the workspace can now ask for

    [Fact]
    public void ToArgs_CarriesTheRangeAndTheGradeTypes()
    {
        var args = CustomReportsController.ToArgs(new CustomPreviewRequest("broker", "share_of_own_volume_pct", false, null, null, null, null, 8, null,
            2026, 28, 2026, 32, ["Off Grade"]));

        Assert.Equal((2026, 28, 2026, 32), (args["from_year"]!.GetValue<int>(), args["from_sale"]!.GetValue<int>(), args["to_year"]!.GetValue<int>(), args["to_sale"]!.GetValue<int>()));
        Assert.Equal("Off Grade", args["grade_types"]![0]!.ToString());
        Assert.Null(CustomReportsController.ToArgs(new CustomPreviewRequest("broker", null, false, null, null, null, null, null, null))["from_year"]);
    }

    [Fact]
    public void Router_NeverAsksForAPeriodWhenTheUserAlreadyChoseOne()
    {
        Assert.Equal("Over which period?", IntentRouter.Decide("Compare brokers", null).Clarify!.Question);
        Assert.Null(IntentRouter.Decide("Compare brokers", null, hasScope: true).Clarify);
        // but it still asks what to compare
        Assert.Equal("What should I compare?", IntentRouter.Decide("Compare performance", null, hasScope: true).Clarify!.Question);
        Assert.Equal("analytics", IntentRouter.Decide("Why is our off-grade quantity higher?", null).Agent);
    }
}
