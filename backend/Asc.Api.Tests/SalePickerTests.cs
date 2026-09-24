using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class SalePickerTests
{
    private static readonly (int, int)[] Sales = [(2026, 32), (2026, 31), (2026, 30), (2025, 51), (2025, 50)];

    [Theory]
    [InlineData("show me sale data")]
    [InlineData("I need the sale results")]
    [InlineData("give me a summary of a sale")]
    [InlineData("how did the sale go")]
    public void AsksForTheYearFirst_OfferingOnlyYearsThatExist(string message)
    {
        var pick = SalePicker.Next(message, null, Sales)!;

        Assert.Null(pick.Chosen);
        Assert.Equal(SalePicker.YearQuestion, pick.Ask!.Question);
        Assert.Equal(["2026", "2025"], pick.Ask.Options);
    }

    [Fact]
    public void AfterTheYear_OffersThatYearsSalesNewestFirst_AndNoOthers()
    {
        var pick = SalePicker.Next("2025", SalePicker.YearQuestion + "\nCLARIFY: {}", Sales)!;

        Assert.Equal("Which sale of 2025?", pick.Ask!.Question);
        Assert.Equal(["Sale 51/2025", "Sale 50/2025"], pick.Ask.Options);
    }

    [Fact]
    public void AfterTheSale_ChoosesExactlyThatSale()
    {
        var pick = SalePicker.Next("Sale 31/2026", "Which sale of 2026?\nCLARIFY: {}", Sales)!;

        Assert.Null(pick.Ask);
        Assert.Equal(new ArchiveScope(2026, 31, 2026, 31), pick.Chosen);
    }

    [Fact]
    public void NeverOffersASaleThatIsNotInTheArchive()
    {
        Assert.Null(SalePicker.Next("Sale 99/2026", "Which sale of 2026?\nCLARIFY: {}", Sales)?.Chosen);
        Assert.Null(SalePicker.Next("2019", SalePicker.YearQuestion, Sales));
    }

    [Fact]
    public void SkipsAQuestionWithOnlyOneAnswer()
    {
        Assert.Equal("Which sale of 2026?", SalePicker.Next("sale data", null, [(2026, 32), (2026, 31)])!.Ask!.Question); // one year: straight to the sale
        Assert.Equal(new ArchiveScope(2026, 32, 2026, 32), SalePicker.Next("sale data", null, [(2026, 32)])!.Chosen);   // one sale: no question at all
    }

    [Fact]
    public void OffersAtMostEightSales()
    {
        var many = Enumerable.Range(1, 30).Select(n => (2026, n)).ToArray();
        Assert.Equal(SalePicker.MaxSales, SalePicker.Next("2026", SalePicker.YearQuestion, many)!.Ask!.Options.Count);
    }

    [Theory]
    [InlineData("sale results for 2026")]
    [InlineData("summary of the latest sale")]
    [InlineData("sale data over the last 12 sales")]
    [InlineData("compare brokers")]
    [InlineData("hello")]
    public void LeavesAlone_AnythingThatAlreadyNamesASale_OrIsAboutSomethingElse(string message)
    {
        Assert.False(SalePicker.Involved(message, null));
        Assert.Null(SalePicker.Next(message, null, Sales));
    }

    [Fact]
    public void DoesNothingWithoutAnyArchiveSales() => Assert.Null(SalePicker.Next("sale data", null, []));
}

public class SalePickerFollowUpTests
{
    private static readonly (int, int)[] Sales = [(2026, 32), (2026, 31), (2025, 32), (2025, 31)];

    [Fact]
    public void ASaleNumberWithoutAYear_AsksWhichYear_OnlyAmongYearsThatHaveIt()
    {
        var pick = SalePicker.Next("show me sale 32", null, Sales)!;
        Assert.Equal("Which year was sale 32?", pick.Ask!.Question);
        Assert.Equal(["2026", "2025"], pick.Ask.Options);

        Assert.Equal(new ArchiveScope(2025, 32, 2025, 32), SalePicker.Next("2025", "Which year was sale 32?\nCLARIFY: {}", Sales)!.Chosen);
        Assert.Null(SalePicker.Next("show me sale 32", null, [(2026, 32), (2026, 31)])); // only one year has it: nothing to ask
        Assert.Null(SalePicker.Next("compare sale 32 with sale 31", null, Sales));        // two numbers: left to the normal routing
    }

    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();

    [Fact]
    public void ALotQuestion_AsksWhichSale_ThenUsesThatCatalogue()
    {
        (Guid, string)[] cats = [(A, "Sale 39 - 2026"), (B, "Sale 38 - 2026")];
        var ask = LotSalePicker.Next("valuation of lot 1204", null, cats)!.Value;
        Assert.Equal(LotSalePicker.Question, ask.Ask!.Question);
        Assert.Equal(["Sale 39 - 2026", "Sale 38 - 2026"], ask.Ask.Options);
        Assert.Equal(B, LotSalePicker.Next("Sale 38 - 2026", LotSalePicker.Question, cats)!.Value.Chosen);
        Assert.Equal(A, LotSalePicker.Next("valuation of lot 5", null, [(A, "Sale 39 - 2026")])!.Value.Chosen); // one sale: no question
    }

    [Theory]
    [InlineData("valuation of lot 1204 in sale 39")]
    [InlineData("valuation of lot 1204 this sale")]
    [InlineData("which garden had the top prices")]
    public void ALotQuestion_ThatNamesASale_OrHasNoLot_IsLeftAlone(string message) => Assert.False(LotSalePicker.Involved(message, null));
}
