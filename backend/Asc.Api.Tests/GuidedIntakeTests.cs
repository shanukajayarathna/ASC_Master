using System.Text.Json.Nodes;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class GuidedIntakeTests
{
    private static readonly IntakeData Data = new(
        Archived: [.. Enumerable.Range(30, 22).Select(n => (2025, n)), .. Enumerable.Range(1, 32).Select(n => (2026, n))],
        Catalogued: [.. Enumerable.Range(33, 8).Select(n => (2026, n)), (2025, 37)],
        AllGrades: ["BOP", "BOPF", "OP", "PEKOE", "FBOP", "OPA", "BP"],
        TopGrades: ["BOP", "BOPF", "OP", "PEKOE", "FBOP", "OPA"],
        MyBroker: "ASC");

    /// <summary>Plays a conversation the way the chat does: each user turn is judged with the earlier turns of the same open request.</summary>
    private sealed class Chat(bool hasScope = false)
    {
        private readonly List<(string Role, string Content, string? Provider)> _prior = [];
        public IntakeOutcome? Last;

        public IntakeOutcome? Say(string text)
        {
            var open = GuidedIntake.OpenTurns(_prior, text);
            Last = GuidedIntake.Involved(open) ? GuidedIntake.Next(open, Data, hasScope) : null;
            _prior.Add(("user", text, null));
            if (Last?.Ask is { } q) _prior.Add(("assistant", (Last.Lead ?? q.Question) + "\n" + IntentRouter.ClarifyReply(q), "router"));
            else if (Last?.Lead is { } lead) _prior.Add(("assistant", lead, "router"));
            return Last;
        }

        public IReadOnlyList<string> Options => Last!.Ask!.Options;
        public string Question => Last!.Ask!.Question;
    }

    // ---------- the sale-37 question from the field

    [Fact]
    public void BestSellingGradeForASale37_AsksMeasure_ThenTheYear_ThenConfirmsCatalogueOnly_ThenAnswersFromTheCatalogue()
    {
        var c = new Chat();
        c.Say("tell me the best selling grade for asia siyaka for sale 37");
        Assert.Equal("By what measure?", c.Question);
        Assert.Equal(["Quantity sold", "Average price", "Total value (proceeds)"], c.Options);
        Assert.Contains("volume, price or value", c.Last!.Lead);

        c.Say("Quantity sold");
        Assert.Equal("Which year was sale 37?", c.Question);
        Assert.Equal(["2026", "2025", GuidedIntake.YouChoose], c.Options); // 2026 is offered (it only exists as a catalogue)

        c.Say("2026");
        Assert.Equal("Sale 37/2026 isn't in the results archive yet.", c.Question);
        Assert.Contains("estimated valuations", c.Last!.Lead);

        c.Say("Yes, show valuations");
        var r = c.Last!.Resolved!;
        Assert.Equal((2026, 37), r.CatalogueSale);
        Assert.Equal("auction", r.AgentKey);
        Assert.Equal("grade", r.GroupBy);
        Assert.Equal(["ASC"], r.Brokers);
        Assert.Equal("sold_quantity_kg", r.Metric);
    }

    [Fact]
    public void ASaleThatHasResults_GoesStraightToThatSalesArchiveScope()
    {
        var c = new Chat();
        c.Say("best selling grade for asia siyaka for sale 37 of 2025");
        c.Say("Average price");
        var r = c.Last!.Resolved!;
        Assert.Equal(new ArchiveScope(2025, 37, 2025, 37), r.Scope);
        Assert.Equal("analytics", r.AgentKey);
        Assert.Equal("avg_price_rs", r.Metric);
    }

    [Fact]
    public void ChoosingAnotherSale_FromTheCatalogueConfirmation_ReopensTheYearAndSaleQuestions()
    {
        var c = new Chat();
        c.Say("best selling grade sale 37");
        c.Say("Average price"); c.Say("2026");
        c.Say("Choose another sale");
        Assert.Equal(SalePicker.YearQuestion, c.Question);
        c.Say("2026");
        Assert.Equal("Which sale of 2026?", c.Question);
        Assert.Equal("Sale 40/2026", c.Options[0]);   // the newest catalogue sale first
        c.Say("Sale 31/2026");
        Assert.Equal(new ArchiveScope(2026, 31, 2026, 31), c.Last!.Resolved!.Scope);
    }

    // ---------- a request too vague to start

    [Theory]
    [InlineData("tea")]
    [InlineData("I need data")]
    [InlineData("analysis")]
    [InlineData("market")]
    [InlineData("show me something")]
    public void AVagueOpener_GetsAMenu(string text)
    {
        var c = new Chat();
        c.Say(text);
        Assert.Equal(GuidedIntake.MenuQuestion, c.Question);
        Assert.Equal(["Check prices", "Compare brokers", "Best-selling grades", "Look up a lot", "Build a report", "Ask about the by-laws"], c.Options);
    }

    [Fact]
    public void MenuThenPrices_AsksWhatFor_ThenWhichGrade_ThenThePeriod_ThenAnswers()
    {
        var c = new Chat();
        c.Say("tea"); c.Say("Check prices");
        Assert.Equal("What should I look at?", c.Question);
        Assert.Contains("One grade", c.Options);

        c.Say("One grade");
        Assert.Equal("Which grade?", c.Question);
        Assert.Equal(["BOP", "BOPF", "OP", "PEKOE", "FBOP", "OPA", "All grades", GuidedIntake.YouChoose], c.Options);

        c.Say("BOPF");
        Assert.Equal("Which period?", c.Question);
        Assert.Equal("Latest sale (32/2026)", c.Options[0]);
        Assert.Contains("A specific sale", c.Options);

        c.Say("Latest sale (32/2026)");
        var r = c.Last!.Resolved!;
        Assert.Equal(["BOPF"], r.Grades);
        Assert.Equal(new ArchiveScope(2026, 32, 2026, 32), r.Scope);
        Assert.Equal("avg_price_rs", r.Metric);
        Assert.Null(r.GroupBy);
    }

    [Fact]
    public void MenuLotAndByLaws_GetTheirOwnShortPaths()
    {
        var c = new Chat();
        c.Say("tea data"); // not small talk, not a topic: menu
        Assert.Equal(GuidedIntake.MenuQuestion, c.Question);
        c.Say("Look up a lot");
        Assert.Contains("lot number", c.Last!.Lead);
        Assert.Null(c.Last.Ask);

        var d = new Chat();
        d.Say("information"); d.Say("Ask about the by-laws");
        Assert.Equal(4, d.Options.Count);
        Assert.Contains("What is the default penalty for a late buyer?", d.Options);
    }

    [Fact]
    public void MenuCompareBrokers_AsksMeasure_ThenPeriod_ThenGroupsByBroker()
    {
        var c = new Chat();
        c.Say("data"); c.Say("Compare brokers");
        Assert.Equal("By what measure?", c.Question);
        c.Say("Total value (proceeds)");
        Assert.Equal("Which period?", c.Question);
        c.Say("Last 12 sales");
        var r = c.Last!.Resolved!;
        Assert.Equal("broker", r.GroupBy);
        Assert.Equal("proceeds_rs", r.Metric);
        Assert.Equal(new ArchiveScope(2026, 21, 2026, 32), r.Scope);
    }

    // ---------- filters, one at a time

    [Fact]
    public void OneElevation_AsksWhichElevation_AndMapsItToTheToolValues()
    {
        var c = new Chat();
        c.Say("what was the average price"); // Prices, no filter
        Assert.Equal("What should I look at?", c.Question);
        c.Say("One elevation");
        Assert.Equal(["High grown", "Medium grown", "Low grown", "All elevations", GuidedIntake.YouChoose], c.Options);
        c.Say("High grown");
        c.Say("Last 4 sales");
        Assert.Equal(["UVA HIGH", "WESTERN HIGH"], c.Last!.Resolved!.Elevations);
    }

    [Fact]
    public void OneBroker_OffersTheUsersBrokerFirst_AndAllBrokers()
    {
        var c = new Chat();
        c.Say("average price"); c.Say("One broker");
        Assert.Equal("Which broker?", c.Question);
        Assert.Equal("ASC (Asia Siyaka)", c.Options[0]);
        Assert.Contains("All brokers", c.Options);
        c.Say("FW (Forbes & Walker)");
        Assert.Equal("Which period?", c.Question);
        c.Say("This year (2026)");
        var r = c.Last!.Resolved!;
        Assert.Equal(["FW"], r.Brokers);
        Assert.Equal(new ArchiveScope(2026, null, 2026, null), r.Scope);
    }

    [Fact]
    public void OurVolume_MeansTheUsersBroker_WithoutAsking()
    {
        var c = new Chat();
        c.Say("how much did we sell");
        Assert.Equal("Which period?", c.Question); // whom is known ("we"), so only the period is missing
        c.Say("Latest sale (32/2026)");
        Assert.Equal(["ASC"], c.Last!.Resolved!.Brokers);
        Assert.Equal("sold_quantity_kg", c.Last.Resolved.Metric);
    }

    [Fact]
    public void OffGradeShare_SetsTheGradeTypeFilter_NotAGradeBreakdown()
    {
        var c = new Chat();
        c.Say("off grade share by broker");
        Assert.Equal("Which period?", c.Question);
        c.Say("Last 4 sales");
        var r = c.Last!.Resolved!;
        Assert.Equal(["Off Grade"], r.GradeTypes);
        Assert.Equal("broker", r.GroupBy);
        Assert.Equal("share_of_own_volume_pct", r.Metric);
    }

    // ---------- reports

    [Fact]
    public void AReport_AsksContent_Period_AndFormat()
    {
        var c = new Chat();
        c.Say("I need a report");
        Assert.Equal("What should the report show?", c.Question);
        c.Say("Prices by broker");
        Assert.Equal("Which period?", c.Question);
        c.Say("This year (2026)");
        Assert.Equal("Which format?", c.Question);
        Assert.Equal(["On screen (chart and table)", "Excel", "PDF", "PowerPoint", GuidedIntake.YouChoose], c.Options);
        c.Say("Excel");
        var r = c.Last!.Resolved!;
        Assert.Equal("reports", r.AgentKey);
        Assert.Equal("excel", r.Format);
        Assert.Equal("broker", r.GroupBy);
        Assert.Equal("avg_price_rs", r.Metric);
    }

    [Fact]
    public void ATrend_AsksHowFarBack_WithoutALatestSaleOption()
    {
        var c = new Chat();
        c.Say("show me the price trend");
        c.Say("Average price");
        Assert.Equal("How far back?", c.Question);
        Assert.DoesNotContain(c.Options, o => o.StartsWith("Latest"));
    }

    // ---------- letting the assistant choose, the cap, and the scope control

    [Fact]
    public void YouChooseForMe_ResolvesWithDefaults_AndSaysWhichWereAssumed()
    {
        var c = new Chat();
        c.Say("best selling grade");
        c.Say("Average price");
        Assert.Contains(GuidedIntake.YouChoose, c.Options);   // offered from the second question on
        c.Say(GuidedIntake.YouChoose);
        var r = c.Last!.Resolved!;
        Assert.Equal(new ArchiveScope(2026, 32, 2026, 32), r.Scope);
        Assert.Contains("the latest sale", r.Assumed);
        Assert.Contains("the latest sale", ResolvedRequest.PromptLine(r));
    }

    [Fact]
    public void TheFirstQuestionHasNoYouChooseButton_ButNeverMoreThanFiveQuestionsAreAsked()
    {
        var c = new Chat();
        c.Say("best selling grade");
        Assert.DoesNotContain(GuidedIntake.YouChoose, c.Options);

        var open = new List<(string, string)> { ("user", "best selling grade") };
        for (var i = 0; i < GuidedIntake.MaxAsks; i++) { open.Add(("assistant", "q\nCLARIFY: {}")); open.Add(("user", "?")); }
        Assert.NotNull(GuidedIntake.Next(open, Data, false)!.Resolved);
    }

    [Fact]
    public void AScopeChosenInTheHeader_AnswersThePeriodQuestion()
    {
        var c = new Chat(hasScope: true);
        c.Say("best selling grade");
        Assert.Equal("By what measure?", c.Question);
        c.Say("Quantity sold");
        var r = c.Last!.Resolved!;
        Assert.Null(r.Scope);                // the header's scope stays in force; nothing is overridden
        Assert.Equal("grade", r.GroupBy);
    }

    // ---------- what must be left alone

    [Theory]
    [InlineData("valuation of lot 1204")]
    [InlineData("what is the default penalty for a late buyer")]
    [InlineData("show the top prices this sale")]
    [InlineData("which garden had the top prices")]
    [InlineData("export this to excel")]
    [InlineData("explain this chart")]
    [InlineData("hello")]
    [InlineData("and for FW?")]
    public void LeavesToTheNormalRouting(string text)
    {
        var c = new Chat();
        Assert.Null(c.Say(text));
    }

    [Fact]
    public void AFullySpecifiedRequest_IsNotInterrupted()
    {
        var c = new Chat();
        Assert.Null(c.Say("average price of BOPF for sale 32 of 2026"));
        Assert.Null(new Chat().Say("compare brokers by average price over the last 12 sales"));
        Assert.Null(new Chat().Say("best selling grade by quantity for sale 31/2026"));
    }

    [Fact]
    public void ANewRequestInTheMiddleOfADialogue_StartsOverInsteadOfMixingSlots()
    {
        var c = new Chat();
        c.Say("best selling grade");           // asks the measure
        c.Say("what is the average price of BOPF"); // longer than an answer: a new request
        Assert.Equal("Which period?", c.Question);   // its own question, not the ranking one
        Assert.DoesNotContain("Grade", c.Options);
    }

    [Fact]
    public void ANumberedSaleWithoutAYear_ThatExistsInOneYear_NeedsNoYearQuestion()
    {
        var c = new Chat();
        c.Say("average price for sale 12");   // sale 12 exists only in 2026 in the archive
        Assert.Equal("What should I look at?", c.Question);
        c.Say("All tea (overall)");
        Assert.Equal(new ArchiveScope(2026, 12, 2026, 12), c.Last!.Resolved!.Scope);
    }

    [Fact]
    public void AnUnknownSale_IsSaidPlainly_AndThePeriodIsAskedAgain()
    {
        var c = new Chat();
        c.Say("average price for all tea sale 77 of 2026");
        Assert.StartsWith("I can't find sale 77/2026", c.Last!.Lead);
        Assert.Equal("Which period?", c.Question);
    }

    // ---------- the resolved request as tool arguments

    [Fact]
    public void ApplyToToolCall_FillsOnlyWhatTheModelLeftOut()
    {
        var r = new ResolvedRequest(IntakeTopic.Ranking, null, null, "grade", "avg_price_rs", ["BOPF"], [], ["ASC"], ["Off Grade"], null, []);
        var filled = JsonNode.Parse(ResolvedRequest.ApplyToToolCall("query_data", "{\"metric\":\"quantity_kg\"}", r))!;
        Assert.Equal("grade", (string?)filled["group_by"]);
        Assert.Equal("quantity_kg", (string?)filled["metric"]);          // the model's own choice is kept
        Assert.Equal("BOPF", (string?)filled["grades"]![0]);
        Assert.Equal("ASC", (string?)filled["brokers"]![0]);
        Assert.Equal("Off Grade", (string?)filled["grade_types"]![0]);
        Assert.Null(filled["elevations"]);
        Assert.Equal("{\"x\":1}", ResolvedRequest.ApplyToToolCall("list_sales", "{\"x\":1}", r));
        Assert.Equal("{bad", ResolvedRequest.ApplyToToolCall("query_data", "{bad", r));
    }

    [Fact]
    public void PromptLine_StatesWhatWasChosen_AndFlagsACatalogueOnlySale()
    {
        var r = new ResolvedRequest(IntakeTopic.Ranking, null, (2026, 37), "grade", "sold_quantity_kg", [], [], ["ASC"], [], null, []);
        var line = ResolvedRequest.PromptLine(r);
        Assert.Contains("group_by=grade", line);
        Assert.Contains("broker=ASC", line);
        Assert.Contains("not in the results archive", line);
        Assert.Equal("", ResolvedRequest.PromptLine(null));
    }

    [Fact]
    public void OpenTurns_OnlySpansTheRequestBeingClarified()
    {
        List<(string, string, string?)> prior =
        [
            ("user", "best selling grade", null), ("assistant", "By what measure?\nCLARIFY: {}", "router"),
            ("user", "Average price", null), ("assistant", "Here is the answer.", "local"),
        ];
        Assert.Single(GuidedIntake.OpenTurns(prior, "compare brokers"));            // after a real answer: a fresh start
        prior[3] = ("assistant", "Which period?\nCLARIFY: {}", "router");
        Assert.Equal(5, GuidedIntake.OpenTurns(prior, "Last 12 sales").Count);      // still answering the same request
    }
}
