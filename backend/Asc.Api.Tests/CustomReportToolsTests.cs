using System.Text.Json.Nodes;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Msl;

namespace Asc.Api.Tests;

public class CustomReportToolsTests
{
    private static FilteredSectionRow Row(string key, decimal totalQty, decimal soldQty = 0, decimal? avg = null, string? label = null) =>
        new(key, label, Lots: (long)(totalQty / 100), SoldLots: (long)(soldQty / 100), TotalQtyKg: totalQty, SoldQtyKg: soldQty,
            ProceedsRs: soldQty * (avg ?? 0), AvgPriceRs: avg, MaxPriceRs: null);

    private static FilterOptionsDto Options() => new(
        Years: [2026], Sales: [], Brokers: [], Elevations: [], Grades: ["BOP", "BOPF", "PEKOE"],
        GradeCategories: new Dictionary<string, string>(), GradeClasses: new Dictionary<string, string[]>(),
        Categories: ["Off Grade", "High & Medium", "Ex-estate"], GradeTypes: ["Main Grade", "Off Grade"],
        TeaTypes: ["Black Tea", "Green Tea"], Manufactures: ["Orthodox", "CTC"], MarkTypes: [], Groups: [], Buyers: [],
        BuyerNames: new Dictionary<string, string>());

    private static JsonNode Args(string json) => JsonNode.Parse(json)!;

    // ---------------------------------------------------------------- filter parsing

    [Fact]
    public void TryParseFilter_CanonicalisesLooseSpellingsAndBrokerShortCodes()
    {
        var ok = CustomReportLogic.TryParseFilter(
            Args("""{"grade_types":["off grade"],"categories":"ex estate","brokers":["asc","BC"],"elevations":["uva high"],"sold_status":"Sold"}"""),
            Options(), out var f, out var error);

        Assert.True(ok, error);
        Assert.Equal(["Off Grade"], f.GradeTypes);
        Assert.Equal(["Ex-estate"], f.Categories);
        Assert.Equal(["AS", "BTL"], f.Brokers); // Excel short codes → MSL codes the archive stores
        Assert.Equal(["UVA HIGH"], f.Elevations);
        Assert.Equal("sold", f.SoldStatus);
    }

    [Fact]
    public void TryParseFilter_UnknownCategory_ReturnsTheValidValues()
    {
        var ok = CustomReportLogic.TryParseFilter(Args("""{"categories":["Rubbish"]}"""), Options(), out _, out var error);

        Assert.False(ok);
        Assert.Contains("Rubbish", error);
        Assert.Contains("Off Grade", error); // the retry hint a small model needs
    }

    [Theory]
    [InlineData("""{"brokers":["XX"]}""", "Unknown broker")]
    [InlineData("""{"sold_status":"maybe"}""", "sold_status")]
    [InlineData("""{"sale_type":"secret"}""", "sale_type")]
    [InlineData("""{"grades":["ZZZ"]}""", "Unknown grade")]
    [InlineData("""{"elevations":["MARS"]}""", "Unknown elevations")]
    public void TryParseFilter_RejectsInvalidValues(string json, string expectedFragment)
    {
        var ok = CustomReportLogic.TryParseFilter(Args(json), Options(), out _, out var error);

        Assert.False(ok);
        Assert.Contains(expectedFragment, error);
    }

    [Fact]
    public void TryParseFilter_NoArguments_LeavesEverythingUnfiltered()
    {
        Assert.True(CustomReportLogic.TryParseFilter(Args("{}"), Options(), out var f, out _));
        Assert.Null(f.Brokers);
        Assert.Null(f.Categories);
        Assert.Equal("all teas", CustomReportLogic.DescribeFilter(f));
    }

    [Fact]
    public void DescribeFilter_ShowsBrokerShortCodes()
    {
        CustomReportLogic.TryParseFilter(Args("""{"grade_types":["Off Grade"],"brokers":["ASC"]}"""), Options(), out var f, out _);

        var text = CustomReportLogic.DescribeFilter(f);

        Assert.Contains("grade type: Off Grade", text);
        Assert.Contains("broker: ASC", text);
    }

    [Fact]
    public void KnownSaleBookCategories_CoverTheOnesUsersAskFor()
    {
        // The agent's lightweight options path relies on this closed set instead of scanning every
        // lot for distinct categories; a missing entry would make a valid category "unknown".
        Assert.Contains("Off Grade", MslClassification.KnownSaleBookCategories);
        Assert.Contains("Ex-estate", MslClassification.KnownSaleBookCategories);
        Assert.Contains("High & Medium", MslClassification.KnownSaleBookCategories);
    }

    // ---------------------------------------------------------------- dataset shaping

    private static readonly CustomReportLogic.MetricDef Qty = CustomReportLogic.Metrics["quantity_kg"];
    private static readonly CustomReportLogic.MetricDef AvgPrice = CustomReportLogic.Metrics["avg_price_rs"];

    [Fact]
    public void BuildDataset_NoSplit_RanksByMetricAndUsesBrokerShortCodes()
    {
        var rows = new List<FilteredSectionRow> { Row("BTL", 1000), Row("AS", 3000), Row("JK", 2000) };

        var d = CustomReportLogic.BuildDataset("id1", "t", "scope", "broker", Qty, split: false, [("Total", rows)], topN: 8);

        Assert.Equal(["ASC", "JK", "BC"], d.Categories); // AS→ASC, largest first
        Assert.Single(d.Series);
        Assert.Equal([3000m, 2000m, 1000m], d.Series[0].Values);
        Assert.True(d.Additive);
    }

    [Fact]
    public void BuildDataset_TopN_FoldsTheRestIntoOther_SoTotalsSurvive()
    {
        var rows = Enumerable.Range(1, 6).Select(i => Row($"G{i}", i * 100)).ToList(); // 100..600, total 2100

        var d = CustomReportLogic.BuildDataset("id", "t", "s", "grade", Qty, split: false, [("Total", rows)], topN: 3);

        Assert.Equal(["G6", "G5", "G4", "Other"], d.Categories);
        Assert.Equal(2100m, d.Series[0].Values.Sum(v => v ?? 0));
        Assert.Equal(600m, d.Series[0].Values[^1]); // G1+G2+G3
    }

    [Fact]
    public void BuildDataset_NonAdditiveMetric_NeverInventsAnOtherBucket()
    {
        var rows = Enumerable.Range(1, 5).Select(i => Row($"G{i}", i * 100, i * 100, avg: 500 + i)).ToList();

        var d = CustomReportLogic.BuildDataset("id", "t", "s", "grade", AvgPrice, split: false, [("Total", rows)], topN: 2);

        Assert.DoesNotContain("Other", d.Categories); // an average of averages would be wrong
        Assert.Equal(2, d.Categories.Count);
        Assert.False(d.Additive);
    }

    [Fact]
    public void BuildDataset_SplitBySale_MakesSalesTheCategoriesAndGroupsTheSeries()
    {
        var s1 = new List<FilteredSectionRow> { Row("AS", 100), Row("BTL", 300) };
        var s2 = new List<FilteredSectionRow> { Row("AS", 200) }; // BTL absent this sale

        var d = CustomReportLogic.BuildDataset("id", "t", "s", "broker", Qty, split: true, [("30/2026", s1), ("31/2026", s2)], topN: 8);

        Assert.Equal(["30/2026", "31/2026"], d.Categories);
        Assert.Equal("Sale", d.CategoryAxis);
        var bc = d.Series.Single(s => s.Name == "BC");
        Assert.Equal([300m, null], bc.Values); // a missing cell stays null, not a fake zero
        var asc = d.Series.Single(s => s.Name == "ASC");
        Assert.Equal([100m, 200m], asc.Values);
    }

    // ---------------------------------------------------------------- markdown

    [Fact]
    public void ToMarkdown_NoSplit_HasShareColumnAndTotalRowSummingTo100()
    {
        var d = CustomReportLogic.BuildDataset("id", "t", "s", "broker", Qty, false,
            [("Total", new List<FilteredSectionRow> { Row("AS", 750), Row("BTL", 250) })], 8);

        var md = CustomReportLogic.ToMarkdown(d, split: false);

        Assert.Contains("| ASC | 750 | 75.0% |", md);
        Assert.Contains("| BC | 250 | 25.0% |", md);
        Assert.Contains("| Total | 1,000 | 100.0% |", md);
    }

    [Fact]
    public void ToMarkdown_Split_HasValueTableAndPerSaleShareTable()
    {
        var d = CustomReportLogic.BuildDataset("id", "t", "s", "broker", Qty, true,
            [("30/2026", new List<FilteredSectionRow> { Row("AS", 100), Row("BTL", 300) })], 8);

        var md = CustomReportLogic.ToMarkdown(d, split: true);

        Assert.Contains("| Sale |", md);
        Assert.Contains("| 30/2026 |", md);
        Assert.Contains("25.0%", md);
        Assert.Contains("75.0%", md);
    }

    // ---------------------------------------------------------------- charts

    private static CustomDataset Single(bool additive = true) => new(
        "id", "Title", "scope", "Qty", "kg", additive, "Broker", ["ASC", "BC"], [new CustomSeries("Qty", [1m, 2m])]);

    private static CustomDataset Multi(bool additive = true) => new(
        "id", "Title", "scope", "Qty", "kg", additive, "Sale", ["30/2026", "31/2026"],
        [new CustomSeries("ASC", [1m, 2m]), new CustomSeries("BC", [3m, null])]);

    [Fact]
    public void TryBuildChartBlock_ValidBar_EmitsFencedParseableSpec()
    {
        var ok = CustomReportLogic.TryBuildChartBlock(Single(), "Bar", "  My chart ", out var block, out var error);

        Assert.True(ok, error);
        Assert.StartsWith("```asc-chart\n", block);
        Assert.EndsWith("\n```", block);
        var json = block["```asc-chart\n".Length..^"\n```".Length];
        var spec = JsonNode.Parse(json)!;
        Assert.Equal("bar", spec["type"]!.GetValue<string>());
        Assert.Equal("My chart", spec["title"]!.GetValue<string>());
        Assert.Equal(2, spec["categories"]!.AsArray().Count);
    }

    [Fact]
    public void TryBuildChartBlock_DefaultsTitleToDatasetTitle()
    {
        CustomReportLogic.TryBuildChartBlock(Multi(), "stacked_bar", null, out var block, out _);

        Assert.Contains("\"title\":\"Title\"", block);
    }

    [Theory]
    [InlineData("stacked_bar")]
    [InlineData("percent_stacked_bar")]
    public void TryBuildChartBlock_StackedNeedsSeveralSeries(string type)
    {
        var ok = CustomReportLogic.TryBuildChartBlock(Single(), type, null, out _, out var error);

        Assert.False(ok);
        Assert.Contains("split_by", error);
    }

    [Fact]
    public void TryBuildChartBlock_PercentStackedRejectsAverages()
    {
        Assert.False(CustomReportLogic.TryBuildChartBlock(Multi(additive: false), "percent_stacked_bar", null, out _, out var error));
        Assert.Contains("totals", error);
    }

    [Fact]
    public void TryBuildChartBlock_PieNeedsOneSeriesOfTotals()
    {
        Assert.False(CustomReportLogic.TryBuildChartBlock(Multi(), "pie", null, out _, out _));
        Assert.False(CustomReportLogic.TryBuildChartBlock(Single(additive: false), "pie", null, out _, out _));
        Assert.True(CustomReportLogic.TryBuildChartBlock(Single(), "pie", null, out _, out _));
    }

    [Fact]
    public void TryBuildChartBlock_LineNeedsTwoCategories_AndUnknownTypeListsValidOnes()
    {
        var one = new CustomDataset("id", "t", "s", "Qty", "kg", true, "Sale", ["30/2026"], [new CustomSeries("A", [1m])]);
        Assert.False(CustomReportLogic.TryBuildChartBlock(one, "line", null, out _, out _));

        Assert.False(CustomReportLogic.TryBuildChartBlock(Single(), "radar", null, out _, out var error));
        Assert.Contains("percent_stacked_bar", error);
    }

    // ---------------------------------------------------------------- placeholder expansion

    private static readonly Dictionary<string, string> Blocks = new(StringComparer.OrdinalIgnoreCase)
    {
        ["1a2b3c4d"] = "```asc-chart\n{\"a\":1}\n```",
        ["deadbeef"] = "```asc-chart\n{\"b\":2}\n```",
    };

    [Fact]
    public void ResolvePlaceholders_ReplacesAReferencedChart()
    {
        var text = CustomReportLogic.ResolvePlaceholders("Here:\n[[chart:1a2b3c4d]]\nDone.", Blocks, ["1a2b3c4d"]);

        Assert.DoesNotContain("[[chart", text);
        Assert.Contains("{\"a\":1}", text);
        Assert.StartsWith("Here:", text);
    }

    [Fact]
    public void ResolvePlaceholders_AppendsChartsTheModelForgotToReference()
    {
        var text = CustomReportLogic.ResolvePlaceholders("No placeholder here.", Blocks, ["deadbeef"]);

        Assert.Contains("No placeholder here.", text);
        Assert.Contains("{\"b\":2}", text);
    }

    [Fact]
    public void ResolvePlaceholders_DropsUnknownIds_AndNeverDuplicatesAUsedChart()
    {
        var text = CustomReportLogic.ResolvePlaceholders("[[ chart : 1a2b3c4d ]] and [[chart:00000000]]", Blocks, ["1a2b3c4d"]);

        Assert.DoesNotContain("00000000", text);
        Assert.Equal(1, text.Split("{\"a\":1}").Length - 1);
    }

    // ---------------------------------------------------------------- tool surface

    [Fact]
    public void ReportsToolExecutor_AdvertisesTheCustomReportTools_ToEveryone()
    {
        foreach (var isAdmin in new[] { true, false })
        {
            var names = ReportsToolExecutor.DefinitionsFor(isAdmin).Select(d => d.Name).ToList();
            Assert.Contains("query_data", names);
            Assert.Contains("make_chart", names);
        }
    }

    [Fact]
    public void Definitions_GroupByEnumMatchesEveryDimensionTheEngineCanSection()
    {
        var dto = new FilteredAnalyticsDto(Row("all", 0), [], [], [], [], [], [], [], [], [], [], [], null!, 0);

        foreach (var dim in CustomReportLogic.Dimensions)
            Assert.NotNull(CustomReportLogic.Section(dto, dim)); // a dimension with no engine section would 500 at runtime
    }

    [Fact]
    public void TryGetChartId_ReadsOnlyMakeChartResults()
    {
        Assert.Equal("1a2b3c4d", ReportsToolExecutor.TryGetChartId("make_chart", """{"chartId":"1a2b3c4d"}"""));
        Assert.Null(ReportsToolExecutor.TryGetChartId("make_chart", """{"error":"nope"}"""));
        Assert.Null(ReportsToolExecutor.TryGetChartId("query_data", """{"chartId":"1a2b3c4d"}"""));
        Assert.Null(ReportsToolExecutor.TryGetChartId("make_chart", "not json"));
    }
}
