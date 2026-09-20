using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Msl;
using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class CustomReportsControllerTests
{
    [Fact]
    public void ToArgs_MapsTheBuilderOntoTheToolArgumentNames()
    {
        var args = CustomReportsController.ToArgs(new CustomPreviewRequest(
            "broker", "avg_price_rs", true, 12, [2026], ["ASC", "FW"], ["BOPF"], 6, "My report"));

        Assert.Equal("broker", args["group_by"]!.ToString());
        Assert.Equal("avg_price_rs", args["metric"]!.ToString());
        Assert.Equal("sale", args["split_by"]!.ToString());
        Assert.Equal(12, args["last_n_sales"]!.GetValue<int>());
        Assert.Equal(2026, args["years"]![0]!.GetValue<int>());
        Assert.Equal(["ASC", "FW"], args["brokers"]!.AsArray().Select(n => n!.ToString()));
        Assert.Equal("BOPF", args["grades"]![0]!.ToString());
        Assert.Equal(6, args["top_n"]!.GetValue<int>());
        Assert.Equal("My report", args["title"]!.ToString());
    }

    [Fact]
    public void ToArgs_OmitsWhatWasNotAsked()
    {
        var args = CustomReportsController.ToArgs(new CustomPreviewRequest("grade", null, false, null, null, [], null, null, " "));

        Assert.Equal("grade", args["group_by"]!.ToString());
        foreach (var key in new[] { "metric", "split_by", "last_n_sales", "years", "brokers", "grades", "top_n", "title" })
            Assert.Null(args[key]);
    }

    [Fact]
    public void ToArgs_ProducesArgumentsTheToolsOwnValidationAccepts()
    {
        // The controller adds no rules of its own: the tool's validation is the single source of truth, so a
        // bad grouping surfaces the tool's message (which lists the valid values).
        Assert.Contains("broker", Asc.Api.Modules.Agents.CustomReportLogic.Dimensions);
        Assert.Contains("avg_price_rs", Asc.Api.Modules.Agents.CustomReportLogic.Metrics.Keys);
        var args = CustomReportsController.ToArgs(new CustomPreviewRequest("broker", "avg_price_rs", false, null, null, null, null, null, null));
        Assert.Contains(args["group_by"]!.ToString(), Asc.Api.Modules.Agents.CustomReportLogic.Dimensions);
    }

    private static FilteredSectionRow Row(string key, long lots, long sold, decimal qty, decimal soldQty, decimal proceeds, decimal? max = null, string? label = null) =>
        new(key, label, lots, sold, qty, soldQty, proceeds, soldQty > 0 ? proceeds / soldQty : null, max);

    [Fact]
    public void MergeRows_SumsAdditiveFieldsAndWeightsTheAverage()
    {
        // Sale A: 100 kg sold for Rs 100,000 (Rs 1,000/kg). Sale B: 300 kg sold for Rs 240,000 (Rs 800/kg).
        var merged = CustomReportLogic.MergeRows([
            [Row("AS", 10, 8, 120, 100, 100_000, 1_200)],
            [Row("AS", 20, 15, 400, 300, 240_000, 950, "Asia Siyaka")],
        ]);

        var r = Assert.Single(merged);
        Assert.Equal("AS", r.Key);
        Assert.Equal("Asia Siyaka", r.Label);
        Assert.Equal(30, r.Lots);
        Assert.Equal(23, r.SoldLots);
        Assert.Equal(520, r.TotalQtyKg);
        Assert.Equal(400, r.SoldQtyKg);
        Assert.Equal(340_000, r.ProceedsRs);
        Assert.Equal(850, r.AvgPriceRs); // 340,000 / 400 — not the mean of 1,000 and 800 (= 900)
        Assert.Equal(1_200, r.MaxPriceRs);
    }

    [Fact]
    public void MergeRows_KeepsKeysApartAndHasNoAverageWhenNothingSold()
    {
        var merged = CustomReportLogic.MergeRows([
            [Row("39/2026", 5, 0, 50, 0, 0)],
            [Row("40/2026", 6, 6, 60, 60, 60_000)],
        ]);

        Assert.Equal(2, merged.Count);
        Assert.Null(merged.Single(r => r.Key == "39/2026").AvgPriceRs);
        Assert.Equal(1_000, merged.Single(r => r.Key == "40/2026").AvgPriceRs);
    }
}
