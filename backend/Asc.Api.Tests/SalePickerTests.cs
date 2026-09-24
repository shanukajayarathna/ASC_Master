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
    [InlineData("show sale data for sale 32")]
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
