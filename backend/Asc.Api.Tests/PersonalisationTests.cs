using Asc.Api.Modules.Assistant;

namespace Asc.Api.Tests;

public class PersonalisationTests
{
    // ---- what counts as small talk

    [Theory]
    [InlineData("hi")]
    [InlineData("Hi!")]
    [InlineData("  hello there  ")]
    [InlineData("Good morning")]
    [InlineData("hey assistant")]
    [InlineData("Ayubowan")]
    public void Match_RecognisesGreetings(string text) => Assert.Equal(SmallTalkKind.Greeting, SmallTalk.Match(text));

    [Theory]
    [InlineData("thanks")]
    [InlineData("Thank you!")]
    [InlineData("ok thanks")]
    public void Match_RecognisesThanks(string text) => Assert.Equal(SmallTalkKind.Thanks, SmallTalk.Match(text));

    [Theory]
    [InlineData("help")]
    [InlineData("What can you do?")]
    [InlineData("who are you")]
    public void Match_RecognisesHelp(string text) => Assert.Equal(SmallTalkKind.Help, SmallTalk.Match(text));

    [Theory]
    [InlineData("hi, compare brokers over the last 12 sales")]   // a real request that happens to start politely
    [InlineData("hello what is the valuation of lot 1204")]
    [InlineData("thanks for the report, now show grades")]
    [InlineData("help me build a weekly broker report")]
    [InlineData("")]
    [InlineData("   ")]
    public void Match_NeverSwallowsARealQuestion(string text) => Assert.Null(SmallTalk.Match(text));

    [Fact]
    public void Match_IgnoresAnythingLong() => Assert.Null(SmallTalk.Match("hi " + new string('x', 80)));

    // ---- the reply

    [Theory]
    [InlineData(6, "Good morning")]
    [InlineData(13, "Good afternoon")]
    [InlineData(19, "Good evening")]
    [InlineData(2, "Hello")]
    [InlineData(null, "Hello")]
    public void Salutation_FollowsTheReadersOwnClock(int? hour, string expected) => Assert.Equal(expected, SmallTalk.Salutation(hour));

    [Fact]
    public void Reply_GreetsByNameAndOffersTheUsersOwnRecentQuestionsAsButtons()
    {
        var reply = SmallTalk.Reply(SmallTalkKind.Greeting, "Shanuka", 9, ["Compare off-grade share by broker", "Top prices this sale"], 2);
        var lines = reply.Split('\n');

        Assert.Equal("Good morning, Shanuka.", lines[0]);
        Assert.Contains("Last time you asked: “Compare off-grade share by broker”.", reply);
        Assert.Contains("You have 2 pinned insights in your library.", reply);
        Assert.Equal("Where would you like to start?", lines[^2]);
        Assert.StartsWith("CLARIFY: {", lines[^1]);
        Assert.Contains("\"Compare off-grade share by broker\"", lines[^1]);
        Assert.Contains("\"Top prices this sale\"", lines[^1]);
        Assert.Contains("\"Compare brokers over the last 12 sales\"", lines[^1]); // padded with a generic one
    }

    [Fact]
    public void Reply_WithNoHistoryOrNameIsPlainAndOffersTheGenericStarters()
    {
        var reply = SmallTalk.Reply(SmallTalkKind.Greeting, null, null, [], 0);

        Assert.StartsWith("Hello.\nWhat would you like to look at?", reply);
        Assert.DoesNotContain("Last time", reply);
        Assert.DoesNotContain("pinned", reply);
        Assert.Contains("Show the top prices this sale", reply);
        Assert.Contains("You have 1 pinned insight in", SmallTalk.Reply(SmallTalkKind.Greeting, "A", 9, [], 1)); // singular
    }

    [Fact]
    public void Reply_NeverOffersMoreThanFourShortcuts_OrOverlongOnes()
    {
        var reply = SmallTalk.Reply(SmallTalkKind.Greeting, "A", 9, ["one question here", "two question here", "three question here", "four question here", new string('x', 90)], 0);
        var options = System.Text.Json.JsonDocument.Parse(reply.Split('\n')[^1]["CLARIFY: ".Length..]).RootElement.GetProperty("options");

        Assert.Equal(SmallTalk.MaxShortcuts, options.GetArrayLength());
        Assert.DoesNotContain(options.EnumerateArray(), o => o.GetString()!.Length > 60);
    }

    [Fact]
    public void Reply_ThanksNeedsNoButtons_AndHelpExplainsWhatItCanDo()
    {
        Assert.DoesNotContain("CLARIFY", SmallTalk.Reply(SmallTalkKind.Thanks, "A", 9, [], 0));
        var help = SmallTalk.Reply(SmallTalkKind.Help, "A", 9, [], 0);
        Assert.Contains("PowerPoint", help);
        Assert.Contains("CLARIFY:", help);
    }

    // ---- which of the user's past questions are worth offering again

    [Fact]
    public void WorthRepeating_KeepsOnlyCompleteDistinctRealQuestions()
    {
        var titles = new[] { "hi", "Compare off-grade share by broker", "compare off-grade share by broker", "ok", "Top prices this sale", "A question that was cut off because it was way too long to keep in full…", "thanks" };

        Assert.Equal(["Compare off-grade share by broker", "Top prices this sale"], SmallTalk.WorthRepeating(titles));
        Assert.Single(SmallTalk.WorthRepeating(titles, take: 1));
    }

    // ---- who is asking

    [Theory]
    [InlineData("Shanuka Jayarathna", "Shanuka")]
    [InlineData("  Nimal  ", "Nimal")]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void FirstNameOf_TakesTheFirstWord(string? display, string? expected) => Assert.Equal(expected, UserContext.FirstNameOf(display));

    [Fact]
    public void PromptLine_LetsWeOurMyMeanTheUsersBroker_AndStaysBackgroundOnly()
    {
        var line = UserContext.PromptLine(new UserContext("Shanuka", "Admin", "ASC"));

        Assert.Contains("Shanuka (Admin)", line);
        Assert.Contains("\"we\", \"our\" or \"my\"", line);
        Assert.Contains("they mean ASC unless they name another", line);
        Assert.Contains("overrides it", line);
        Assert.Equal("", UserContext.PromptLine(null));
        Assert.DoesNotContain("()", UserContext.PromptLine(new UserContext("A", null, "FW")));
    }

    // ---- settings

    [Fact]
    public void Validate_OnlyRealBrokerCodes()
    {
        foreach (var b in AssistantPreferences.Brokers) Assert.Null(PersonalisationController.Validate(new AssistantPreferencesDto(b, true)));
        Assert.Null(PersonalisationController.Validate(new AssistantPreferencesDto(" fw ", false)));
        Assert.NotNull(PersonalisationController.Validate(new AssistantPreferencesDto("XYZ", true)));
        Assert.NotNull(PersonalisationController.Validate(null));
        Assert.Equal("ASC", new AssistantPreferences().MyBroker);
        Assert.True(new AssistantPreferences().Personalise); // on unless the user turns it off
    }
}
