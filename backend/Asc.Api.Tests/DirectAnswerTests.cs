using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class DirectAnswerTests
{
    private static ResolvedRequest Req(IntakeTopic topic, string? groupBy, string metric, string[]? grades = null, string[]? brokers = null, string[]? assumed = null) =>
        new(topic, new ArchiveScope(2026, 32, 2026, 32), null, groupBy, metric, grades ?? [], [], brokers ?? [], [], null, assumed ?? []);

    private static CustomPreview Preview(string axis, string metric, string unit, bool additive, string[] cats, decimal?[] values) =>
        new("T", "all brokers · sale 32/2026", metric, unit, additive, false, axis, cats, [new CustomSeries(metric, values)], "| table |\n|---|\n| rows |");

    [Fact]
    public void CanAnswer_OnlyWhenTheArchiveHasEverythingItNeeds()
    {
        var scope = new ArchiveScope(2026, 32, 2026, 32);
        Assert.True(DirectAnswer.CanAnswer(Req(IntakeTopic.Ranking, "grade", "sold_quantity_kg"), scope));
        Assert.True(DirectAnswer.CanAnswer(Req(IntakeTopic.TopPrice, "sale", "max_price_rs", ["BOP1A"]), scope));
        Assert.True(DirectAnswer.CanAnswer(Req(IntakeTopic.Prices, null, "avg_price_rs", ["BOPF"]), scope));
        Assert.False(DirectAnswer.CanAnswer(Req(IntakeTopic.Ranking, "grade", "sold_quantity_kg"), null));          // no period
        Assert.False(DirectAnswer.CanAnswer(Req(IntakeTopic.Ranking, null, "sold_quantity_kg"), scope));             // nothing to rank by
        Assert.False(DirectAnswer.CanAnswer(Req(IntakeTopic.Report, "broker", "avg_price_rs"), scope));               // a report is built by the Reports agent
        Assert.False(DirectAnswer.CanAnswer(Req(IntakeTopic.Ranking, "grade", "sold_quantity_kg") with { CatalogueSale = (2026, 37) }, scope)); // catalogue-only sale: valuations, not results
    }

    [Fact]
    public void ToArgs_CarriesExactlyWhatWasChosen()
    {
        var args = DirectAnswer.ToArgs(new ResolvedRequest(IntakeTopic.Ranking, null, null, "grade", "sold_quantity_kg", ["BOP1A"], ["LOW"], ["ASC"], ["Off Grade"], null, []), new ArchiveScope(2025, 40, 2026, 5));
        Assert.Equal("grade", (string?)args["group_by"]);
        Assert.Equal("sold_quantity_kg", (string?)args["metric"]);
        Assert.Equal(2025, (int?)args["from_year"]);
        Assert.Equal(5, (int?)args["to_sale"]);
        Assert.Equal("BOP1A", (string?)args["grades"]![0]);
        Assert.Equal("LOW", (string?)args["elevations"]![0]);
        Assert.Equal("ASC", (string?)args["brokers"]![0]);
        Assert.Equal("Off Grade", (string?)args["grade_types"]![0]);
        Assert.Equal("sale", (string?)DirectAnswer.ToArgs(Req(IntakeTopic.TopPrice, null, "max_price_rs"), new ArchiveScope(2026, 1, 2026, 3))["group_by"]); // no breakdown chosen: per sale
    }

    [Fact]
    public void Ranking_NamesTheLeader_WithItsShare_TheTable_TheChart_AndTheScopeLine()
    {
        var reply = DirectAnswer.Reply(Req(IntakeTopic.Ranking, "grade", "sold_quantity_kg", brokers: ["ASC"]),
            Preview("Grade", "Quantity sold (kg)", "kg", true, ["BOPF", "BOP", "OP"], [600_000m, 300_000m, 100_000m]))!;

        Assert.StartsWith("Top grade by quantity sold for ASC: BOPF — 600,000 kg (60.0% of the total shown).", reply);
        Assert.Contains("| table |", reply);                      // the archive's own table, verbatim
        Assert.Contains("```asc-chart", reply);
        Assert.EndsWith("Scope: all brokers · sale 32/2026 · Source: MSL auction archive (settled results).", reply);
    }

    [Fact]
    public void TopPrice_ForASale_SaysWhichSaleAndTheUnit_AndOrdersSalesByDateAcrossYears()
    {
        var p = Preview("Sale", "Highest price (Rs/kg)", "Rs/kg", false, ["51/2025", "52/2025", "05/2026"], [3400.5m, 2900m, 2100m]);
        var reply = DirectAnswer.Reply(Req(IntakeTopic.TopPrice, "sale", "max_price_rs", grades: ["BOP1A"]), p)!;

        Assert.StartsWith("The highest price for BOP1A was Rs 3,400.50/kg, in sale 51/2025.", reply);
        Assert.Contains("the highest single-lot price per kg", reply);
        Assert.Contains("\"type\":\"line\"", reply);
        // the chart reads in time order: 2025's sales come before 2026's, not sorted by sale number
        Assert.True(reply.IndexOf("\"51/2025\"", StringComparison.Ordinal) < reply.IndexOf("\"05/2026\"", StringComparison.Ordinal));
    }

    [Fact]
    public void ASingleFigure_IsStatedPlainly_WithoutAChart()
    {
        var reply = DirectAnswer.Reply(Req(IntakeTopic.Prices, null, "avg_price_rs", grades: ["BOPF"]),
            Preview("Sale", "Average price (Rs/kg)", "Rs/kg", false, ["32/2026"], [1234.5m]))!;

        Assert.StartsWith("Average price for BOPF: Rs 1,234.50/kg (32/2026).", reply);
        Assert.DoesNotContain("asc-chart", reply);
    }

    [Fact]
    public void Compare_NamesHighestAndLowest()
    {
        var reply = DirectAnswer.Reply(Req(IntakeTopic.Compare, "broker", "avg_price_rs"),
            Preview("Broker", "Average price (Rs/kg)", "Rs/kg", false, ["ASC", "FW", "BC"], [1200m, 1100m, 980m]))!;
        Assert.StartsWith("Highest average price: ASC at Rs 1,200.00/kg; lowest: BC at Rs 980.00/kg.", reply);
    }

    [Fact]
    public void ShareAndPercent_AndWhatTheUserLeftToTheAssistant_AreSaid()
    {
        var reply = DirectAnswer.Reply(Req(IntakeTopic.Compare, "broker", "share_of_own_volume_pct", assumed: ["the latest sale"]),
            Preview("Broker", "Share of own offered volume (%)", "%", false, ["ASC", "FW"], [12.34m, 8m]))!;
        Assert.Contains("12.3%", reply);
        Assert.Contains("You let me choose: the latest sale.", reply);
    }

    [Fact]
    public void AnEmptyOrAllBlankDataset_FallsBackToTheAgents()
    {
        var r = Req(IntakeTopic.Ranking, "grade", "sold_quantity_kg");
        Assert.Null(DirectAnswer.Reply(r, Preview("Grade", "m", "kg", true, [], [])));
        Assert.Null(DirectAnswer.Reply(r, Preview("Grade", "m", "kg", true, ["BOP"], [null])));
    }

    [Fact]
    public void ASalesBreakdownAcrossAYearBoundary_ReadsInTimeOrder_NotTextOrder()
    {
        static Asc.Api.Modules.Msl.FilteredSectionRow Row(string key, decimal max) => new(key, null, 1, 1, 10, 10, 100, 10, max);
        var metric = CustomReportLogic.Metrics["max_price_rs"];
        var d = CustomReportLogic.BuildDataset("x", "t", "s", "sale", metric, false, [("Total", [Row("05/2026", 1), Row("51/2025", 2), Row("52/2025", 3), Row("06/2026", 4)])], 12);
        Assert.Equal(["51/2025", "52/2025", "05/2026", "06/2026"], d.Categories);
        Assert.Equal(int.MaxValue, CustomReportLogic.SaleOrderKey("Total"));
    }
}
