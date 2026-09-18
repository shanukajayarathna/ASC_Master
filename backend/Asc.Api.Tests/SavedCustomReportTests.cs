using Asc.Api.Models;
using Asc.Api.Modules.Reports;

namespace Asc.Api.Tests;

public class SavedCustomReportTests
{
    private const string Chart = "Scope.\n\n```asc-chart\n{\"type\":\"bar\"}\n```";

    [Fact]
    public void Validate_AcceptsATitledAnswerContainingAChart()
    {
        Assert.Null(ReportsController.ValidateCustomReport("Off-grade share by broker", Chart));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validate_RejectsAMissingTitle(string? title)
    {
        Assert.Contains("title", ReportsController.ValidateCustomReport(title, Chart), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_RejectsATitleOverTheLimit_ButCountsOnlyTrimmedLength()
    {
        var atLimit = "  " + new string('a', ReportsController.MaxCustomTitleChars) + "  ";
        Assert.Null(ReportsController.ValidateCustomReport(atLimit, Chart));

        var over = new string('a', ReportsController.MaxCustomTitleChars + 1);
        Assert.NotNull(ReportsController.ValidateCustomReport(over, Chart));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  \n ")]
    public void Validate_RejectsEmptyContent(string? content)
    {
        Assert.NotNull(ReportsController.ValidateCustomReport("Title", content));
    }

    [Fact]
    public void Validate_RejectsAnAnswerWithNoChart()
    {
        // Saved Reports is for reports with charts; plain chat text isn't a report.
        var error = ReportsController.ValidateCustomReport("Title", "Just a plain answer with no chart.");
        Assert.Contains("chart", error, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validate_RejectsOversizedContent()
    {
        var huge = Chart + new string('x', ReportsController.MaxCustomContentChars);
        Assert.Contains("too large", ReportsController.ValidateCustomReport("Title", huge), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CustomChartType_IsTheStableStoredValue()
    {
        // The frontend and existing saved documents key off this exact string.
        Assert.Equal("custom-chart", SavedReport.CustomChartType);
    }
}
