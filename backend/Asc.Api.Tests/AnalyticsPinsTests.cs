using Asc.Api.Modules.Assistant;

namespace Asc.Api.Tests;

public class AnalyticsPinsTests
{
    private static CreatePinRequest Chart() => new("chart-abc", "chart", "Average price by broker", "{\"type\":\"bar\"}", null);
    private static CreatePinRequest Answer() => new("answer-abc", "answer", "Forbes led", null, "Forbes had the highest average.");

    [Fact]
    public void Validate_AcceptsAChartAndAnAnswer()
    {
        Assert.Null(AnalyticsPinsController.Validate(Chart()));
        Assert.Null(AnalyticsPinsController.Validate(Answer()));
    }

    [Fact]
    public void Validate_RejectsAnythingIncomplete()
    {
        Assert.NotNull(AnalyticsPinsController.Validate(null));
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { Key = " " }));
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { Kind = "video" }));
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { Title = "" }));
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { ChartJson = null }));
        Assert.NotNull(AnalyticsPinsController.Validate(Answer() with { Text = null }));
    }

    [Fact]
    public void Validate_BoundsWhatIsStored()
    {
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { ChartJson = new string('x', AnalyticsPinsController.MaxJsonChars + 1) }));
        Assert.NotNull(AnalyticsPinsController.Validate(Answer() with { Text = new string('x', AnalyticsPinsController.MaxTextChars + 1) }));
        Assert.NotNull(AnalyticsPinsController.Validate(Chart() with { Title = new string('x', 301) }));
    }

    [Fact]
    public void ToDto_ExposesTheKeyAndContentButNotTheOwner()
    {
        var pin = new AnalyticsPin { OwnerId = "u1", ContentKey = "k", Kind = "chart", Title = "T", ChartJson = "{}" };
        var dto = AnalyticsPinsController.ToDto(pin);

        Assert.Equal((pin.Id, "k", "chart", "T", "{}"), (dto.Id, dto.Key, dto.Kind, dto.Title, dto.ChartJson));
        Assert.DoesNotContain(typeof(AnalyticsPinDto).GetProperties(), p => p.Name == "OwnerId");
        Assert.Equal(12, AnalyticsPinsController.MaxPins);
    }
}
