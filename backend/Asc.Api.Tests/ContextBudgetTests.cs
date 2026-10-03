using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class ContextBudgetTests
{
    [Fact]
    public void ChartJsonIsNeverResent()
    {
        var chart = "Here it is.\n```asc-chart\n{\"categories\":[\"A\",\"B\"],\"series\":[{\"values\":[1,2]}]}\n```";
        var kept = ContextBudget.Compact([("user", "q"), ("assistant", chart), ("user", "next")]);
        Assert.Equal("Here it is.\n[chart shown earlier]", kept[1].Content);
    }

    [Fact]
    public void ButtonQuestionsAreDropped_TheCurrentMessageIsKept()
    {
        var kept = ContextBudget.Compact([("user", "tea data"), ("assistant", "Pick one\nCLARIFY: {\"question\":\"Q?\",\"options\":[\"a\",\"b\"]}"), ("user", "a")]);
        Assert.DoesNotContain(kept, m => m.Content.Contains("CLARIFY"));
        Assert.Equal(("user", "a"), kept[^1]);
    }

    [Fact]
    public void OnlyTheNewestExchangesAreKept_AndLongTurnsAreCut()
    {
        var history = new List<(string Role, string Content)>();
        for (var i = 0; i < 10; i++) { history.Add(("user", $"q{i}")); history.Add(("assistant", new string('x', 5000))); }
        history.Add(("user", "now"));
        var kept = ContextBudget.Compact(history);
        Assert.True(kept.Count <= ContextBudget.MaxTurns * 2 + 1);
        Assert.Equal("now", kept[^1].Content);
        Assert.All(kept, m => Assert.True(m.Content.Length <= ContextBudget.MaxCharsPerTurn + 2));
    }
}
