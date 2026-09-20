using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class IntentRouterTests
{
    private static string Ask(string what) => IntentRouter.ClarifyReply(new ClarifyQuestion(what, ["a", "b"]));

    // ---- which agent answers

    [Theory]
    [InlineData("What is the default penalty for a late buyer?", "general")]
    [InlineData("When is prompt day?", "general")]
    [InlineData("Export the broker trend to Excel", "reports")]
    [InlineData("Make a PowerPoint of last 12 sales", "reports")]
    [InlineData("What is the valuation of lot 1204?", "auction")]
    [InlineData("Which garden had the top prices this sale?", "auction")]
    [InlineData("Compare brokers for BOPF over the last 12 sales", "analytics")]
    [InlineData("How did average price trend over 13 years?", "analytics")]
    [InlineData("hello there", "general")]
    public void Decide_PicksTheAgentFromTheWords(string message, string expected)
    {
        var d = IntentRouter.Decide(message, null);
        Assert.Equal(expected, d.Agent);
        Assert.Null(d.Clarify); // each of these is specific enough to answer
    }

    [Fact]
    public void Decide_AByLawsQuestionIsNotMistakenForAnAnalysis()
    {
        Assert.Equal("general", IntentRouter.Decide("Compare the default penalties for buyers and brokers", null).Agent);
    }

    [Fact]
    public void Decide_LotQuestionsMentioningBrokersStillGoToAnalyticsOnlyWhenAnalytical()
    {
        Assert.Equal("auction", IntentRouter.Decide("Explain the valuation for lot 1204 (Kenilworth)", null).Agent);
        Assert.Equal("analytics", IntentRouter.Decide("Compare lot prices by broker over the last 4 sales", null).Agent);
    }

    [Fact]
    public void Decide_AShortFollowUpStaysWithThePreviousAgent()
    {
        Assert.Equal("analytics", IntentRouter.Decide("and for FW?", "analytics").Agent);
        Assert.Equal("auction", IntentRouter.Decide("what about the second one", "auction").Agent);
        Assert.Equal("general", IntentRouter.Decide("and for FW?", null).Agent);
        // …but a fresh, clearly different request moves on
        Assert.Equal("general", IntentRouter.Decide("Explain the deposit rule in detail please", "analytics").Agent);
    }

    [Fact]
    public void Decide_IgnoresAnUnknownPreviousAgent()
    {
        Assert.Equal("general", IntentRouter.Decide("ok", "made-up").Agent);
    }

    // ---- asking one short question first

    [Fact]
    public void Decide_AVagueComparisonAsksWhatToCompare()
    {
        var d = IntentRouter.Decide("Compare performance", null);
        Assert.Equal("analytics", d.Agent);
        Assert.Equal("What should I compare?", d.Clarify!.Question);
        Assert.Equal(["Brokers", "Grades", "Sales over time"], d.Clarify.Options);
    }

    [Fact]
    public void Decide_AComparisonWithoutAPeriodAsksThePeriod()
    {
        var d = IntentRouter.Decide("Compare brokers", null);
        Assert.Equal("Over which period?", d.Clarify!.Question);
        Assert.Equal(["Last 4 sales", "Last 12 sales", "This year"], d.Clarify.Options);
    }

    [Fact]
    public void Decide_ASpecificRequestIsNeverQuestioned()
    {
        Assert.Null(IntentRouter.Decide("Compare brokers over the last 12 sales", null).Clarify);
        Assert.Null(IntentRouter.Decide("Compare grades this year", null).Clarify);
        Assert.Null(IntentRouter.Decide("Build a report of broker share for 2025", null).Clarify);
    }

    [Fact]
    public void Decide_AnAnswerToOurQuestionContinuesTheRequest_AndMayAskTheNextMissingDetail()
    {
        // "Compare performance" -> asked what -> user says "Brokers": the period is still missing, so ask it.
        var d = IntentRouter.Decide("Brokers", "analytics", [Ask("What should I compare?")], "Compare performance");
        Assert.Equal("analytics", d.Agent);
        Assert.Equal("Over which period?", d.Clarify!.Question);

        // After the period is given nothing is missing: answer with the same agent.
        var done = IntentRouter.Decide("Last 12 sales", "analytics", [Ask("What should I compare?"), Ask("Over which period?")], "Brokers");
        Assert.Equal("analytics", done.Agent);
        Assert.Null(done.Clarify);
    }

    [Fact]
    public void Decide_NeverAsksMoreThanTwoQuestionsInARow()
    {
        var d = IntentRouter.Decide("Compare performance", null, [Ask("one"), Ask("two")]);
        Assert.Null(d.Clarify);
        Assert.Equal("analytics", d.Agent);
    }

    [Fact]
    public void Decide_OnlyAnalysisAndReportRequestsAreEverQuestioned()
    {
        Assert.Null(IntentRouter.Decide("What is the valuation of lot 12?", null).Clarify);
        Assert.Null(IntentRouter.Decide("Explain the deposit rule", null).Clarify);
        Assert.Null(IntentRouter.Decide("hello", null).Clarify);
    }

    // ---- the message that carries the question

    [Fact]
    public void ClarifyReply_IsALeadInPlusTheMachineLineTheChatTurnsIntoButtons()
    {
        var reply = IntentRouter.ClarifyReply(new ClarifyQuestion("Over which period?", ["Last 4 sales", "This year"]));
        var lines = reply.Split('\n');

        Assert.Equal("Over which period?", lines[0]);
        Assert.StartsWith("CLARIFY: {", lines[1]);
        Assert.Contains("\"options\":[\"Last 4 sales\",\"This year\"]", lines[1]);
        Assert.Contains("CLARIFY:", reply); // what Decide looks for when counting questions
    }
}
