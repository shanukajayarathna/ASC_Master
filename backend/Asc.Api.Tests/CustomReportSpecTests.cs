using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class CustomReportSpecTests
{
    private static CustomPreview Preview(int categories = 3, int series = 1) => new(
        "Average price (Rs/kg) by broker", "all brokers · the last 12 sales", "Average price (Rs/kg)", "Rs/kg", false, false, "Broker",
        [.. Enumerable.Range(0, categories).Select(i => $"C{i}")],
        [.. Enumerable.Range(0, series).Select(s => new CustomSeries($"S{s}", [.. Enumerable.Range(0, categories).Select(i => (decimal?)(100 + i))]))],
        "| Broker | Avg |\n|---|---|\n| C0 | 100 |");

    private static CreateSpecRequest Good() => new("Weekly broker prices", new CustomPreviewRequest("broker", "avg_price_rs", false, 12, null, null, null, 8, null), "bar");

    // ---- validation

    [Fact]
    public void ValidateSpec_AcceptsAGoodSpec() => Assert.Null(CustomReportsController.ValidateSpec(Good()));

    [Fact]
    public void ValidateSpec_RejectsWhatCannotRun_WithoutQueryingTheArchive()
    {
        Assert.NotNull(CustomReportsController.ValidateSpec(null));
        Assert.NotNull(CustomReportsController.ValidateSpec(Good() with { Title = "  " }));
        Assert.NotNull(CustomReportsController.ValidateSpec(Good() with { Title = new string('x', 201) }));
        Assert.Contains("groupBy", CustomReportsController.ValidateSpec(Good() with { Request = Good().Request with { GroupBy = "planet" } })!);
        Assert.Contains("metric", CustomReportsController.ValidateSpec(Good() with { Request = Good().Request with { Metric = "vibes" } })!);
        Assert.NotNull(CustomReportsController.ValidateSpec(Good() with { Visual = "pie3d" }));
    }

    // ---- snapshot

    [Fact]
    public void Build_HasTitleScopeChartTableAndSource_LikeAManualSnapshot()
    {
        var md = CustomReportSnapshot.Build(Preview(), "bar");

        Assert.StartsWith("## Average price (Rs/kg) by broker\nall brokers · the last 12 sales", md);
        Assert.Contains("```asc-chart", md);
        Assert.Contains("\"type\":\"bar\"", md);
        Assert.Contains("| C0 | 100 |", md);
        Assert.EndsWith("_Source: ASC Intelligence Hub — MSL auction archive._", md);
    }

    [Fact]
    public void Build_ATableHasNoChart()
    {
        Assert.DoesNotContain("asc-chart", CustomReportSnapshot.Build(Preview(), "table"));
    }

    [Theory]
    [InlineData("line", 3, 1, "line")]
    [InlineData("line", 1, 1, "bar")]            // a line needs two points
    [InlineData("bar", 10, 1, "horizontal_bar")] // long single series reads sideways
    [InlineData("bar", 10, 3, "bar")]
    [InlineData("table", 3, 1, null)]
    public void ChartType_FollowsTheVisualWithSensibleFallbacks(string visual, int categories, int series, string? expected)
    {
        Assert.Equal(expected, CustomReportSnapshot.ChartType(Preview(categories, series), visual));
    }

    [Fact]
    public void Request_RoundTripsThroughItsStoredText()
    {
        var request = new CustomPreviewRequest("grade", "sold_quantity_kg", false, 4, [2026], ["ASC", "FW"], ["BOPF"], 6, "T");
        var back = CustomReportSnapshot.Deserialize(CustomReportSnapshot.Serialize(request))!;

        Assert.Equal(request.GroupBy, back.GroupBy);
        Assert.Equal(request.Brokers, back.Brokers);
        Assert.Equal(request.Grades, back.Grades);
        Assert.Equal(request.LastNSales, back.LastNSales);
        Assert.Null(CustomReportSnapshot.Deserialize("not json"));
    }

    // ---- the job's contract

    [Fact]
    public void TheJob_RunsWeeklyOnMondayMorning_AndHasAStableKey()
    {
        var job = new CustomReportSpecsJob(null!, null!, null!, null!);
        Assert.Equal("custom-report-specs", job.Key);
        Assert.Equal("0 6 * * 1", job.Trigger.CronExpression);
        Assert.Equal(Asc.Api.Modules.ScheduledReports.ReportJobCadence.Weekly, job.Cadence);
        Assert.Equal("custom-chart", SavedReport.CustomChartType);
    }
}
