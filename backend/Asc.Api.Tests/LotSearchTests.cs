using Asc.Api.Models;
using Asc.Api.Services;

namespace Asc.Api.Tests;

/// <summary>
/// LotSearch is the server-side twin of the browser's filterLots (frontend/src/lib/lotFilters.ts): the same
/// filter panel state must select the same lots. These tests pin each rule, including the JavaScript
/// parseFloat quirks the numeric and lot-range filters have always had.
/// </summary>
public class LotSearchTests
{
    private static Lot MakeLot(string lotNo, Dictionary<string, string>? raw = null, string? year = "2026") => new()
    {
        Id = Guid.NewGuid(), LotNumber = lotNo, SaleYear = year,
        RawData = new Dictionary<string, string>(raw ?? new()) { ["Lot No"] = lotNo },
    };

    private static List<(Lot Lot, Valuation? Val)> Pair(params Lot[] lots) => lots.Select(l => (l, l.Valuation)).ToList();

    private static List<string?> Nos(LotSearchRequest req, params Lot[] lots) =>
        LotSearch.Filter(Pair(lots), req).Select(x => x.Lot.LotNumber).ToList();

    private static ColumnFilterDto Cat(params string[] values) => new() { Kind = "categorical", Values = values.ToList() };

    // ---- JavaScript parseFloat ----------------------------------------------------------------

    [Theory]
    [InlineData("12abc", 12.0)]
    [InlineData(".5", 0.5)]
    [InlineData("1e3", 1000.0)]
    [InlineData("-3", -3.0)]
    [InlineData("  42 ", 42.0)]
    public void JsParseFloat_TakesTheLeadingNumber(string input, double expected) =>
        Assert.Equal(expected, LotSearch.JsParseFloat(input));

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("--")]
    public void JsParseFloat_IsNaN_WhenThereIsNoLeadingNumber(string input) =>
        Assert.True(double.IsNaN(LotSearch.JsParseFloat(input)));

    // ---- universal search + text -------------------------------------------------------------

    [Fact]
    public void UniversalSearch_IsCaseInsensitive_AcrossEveryColumn()
    {
        var a = MakeLot("1", new() { ["Selling Mark"] = "GREEN RIDGE" });
        var b = MakeLot("2", new() { ["Selling Mark"] = "OTHER", ["Remarks"] = "green tip" });
        var c = MakeLot("3", new() { ["Selling Mark"] = "OTHER" });
        Assert.Equal(["1", "2"], Nos(new() { Search = "  GrEeN " }, a, b, c));
    }

    [Fact]
    public void TextFilter_IsContainsIgnoringCase_AndBlankIsIgnored()
    {
        var a = MakeLot("1", new() { ["Factory Name"] = "Ancoombra Estate" });
        var b = MakeLot("2", new() { ["Factory Name"] = "Robgill" });
        Assert.Equal(["1"], Nos(new() { ColumnFilters = new() { ["Factory Name"] = new() { Kind = "text", Value = "COOMB" } } }, a, b));
        Assert.Equal(["1", "2"], Nos(new() { ColumnFilters = new() { ["Factory Name"] = new() { Kind = "text", Value = "   " } } }, a, b));
    }

    // ---- categorical -------------------------------------------------------------------------

    [Fact]
    public void Categorical_IsAnExactMatch_AnyOfTheValues()
    {
        var a = MakeLot("1", new() { ["Broker"] = "ASC" });
        var b = MakeLot("2", new() { ["Broker"] = "asc" });   // different case: not the same value
        var c = MakeLot("3", new() { ["Broker"] = "CT" });
        var d = MakeLot("4"); // no Broker column at all
        Assert.Equal(["1", "3"], Nos(new() { ColumnFilters = new() { ["Broker"] = Cat("ASC", "CT") } }, a, b, c, d));
    }

    [Fact]
    public void AnEmptyCategoricalSelection_FiltersNothing()
    {
        var a = MakeLot("1", new() { ["Broker"] = "ASC" });
        Assert.Equal(["1"], Nos(new() { ColumnFilters = new() { ["Broker"] = Cat() } }, a));
    }

    // ---- numeric -----------------------------------------------------------------------------

    [Fact]
    public void Numeric_ReadsThousandsSeparators_AndTheLeadingNumber()
    {
        var a = MakeLot("1", new() { ["Price"] = "1,200" });
        var b = MakeLot("2", new() { ["Price"] = "900" });
        var c = MakeLot("3", new() { ["Price"] = "1450abc" });
        var d = MakeLot("4", new() { ["Price"] = "n/a" });
        var req = new LotSearchRequest { ColumnFilters = new() { ["Price"] = new() { Kind = "numeric", Min = "1000", Max = "1500" } } };
        Assert.Equal(["1", "3"], Nos(req, a, b, c, d)); // 900 too low; "n/a" is NaN so it never passes a bound
    }

    [Fact]
    public void Numeric_OneSidedBounds()
    {
        var a = MakeLot("1", new() { ["Price"] = "500" });
        var b = MakeLot("2", new() { ["Price"] = "1500" });
        Assert.Equal(["2"], Nos(new() { ColumnFilters = new() { ["Price"] = new() { Kind = "numeric", Min = "1000", Max = "" } } }, a, b));
        Assert.Equal(["1"], Nos(new() { ColumnFilters = new() { ["Price"] = new() { Kind = "numeric", Min = "", Max = "1000" } } }, a, b));
    }

    // ---- lot: range OR picked ----------------------------------------------------------------

    [Fact]
    public void Lot_MatchesTheRange_OrAnyPickedLot()
    {
        var lots = Enumerable.Range(1, 10).Select(i => MakeLot(i.ToString())).ToArray();
        var req = new LotSearchRequest
        {
            ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Min = "3", Max = "5", Values = ["9"] } },
        };
        Assert.Equal(["3", "4", "5", "9"], Nos(req, lots));
    }

    [Fact]
    public void Lot_PickedOnly_AndRangeOnly()
    {
        var lots = Enumerable.Range(1, 6).Select(i => MakeLot(i.ToString())).ToArray();
        Assert.Equal(["2", "6"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["2", "6"] } } }, lots));
        Assert.Equal(["5", "6"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Min = "5" } } }, lots));
    }

    // ---- valuation-derived filters ------------------------------------------------------------

    private static (Lot, Valuation?) WithValuation(string no, Valuation? v)
    {
        var l = MakeLot(no);
        return (l, v);
    }

    [Fact]
    public void Status_EmptyPartialFull_FollowTheTicketRules()
    {
        var empty = WithValuation("1", null);
        var partial = WithValuation("2", new Valuation { ValuationSingle = 1500 });
        var full = WithValuation("3", new Valuation { ValuationSingle = 1500, StandardData = "S", LiquorRemarks = "L" });
        var all = new List<(Lot, Valuation?)> { empty, partial, full };
        List<string?> Run(string status) => LotSearch.Filter(all, new() { Status = status }).Select(x => x.Lot.LotNumber).ToList();
        Assert.Equal(["1"], Run("empty"));
        Assert.Equal(["2"], Run("partial"));
        Assert.Equal(["3"], Run("full"));
    }

    [Fact]
    public void Classification_NoValuationCountsAsUnclassified()
    {
        var none = WithValuation("1", null);
        var best = WithValuation("2", new Valuation { ValuationSingle = 1500, Classification = Classification.Best });
        var all = new List<(Lot, Valuation?)> { none, best };
        Assert.Equal(["1"], LotSearch.Filter(all, new() { Classification = "Unclassified" }).Select(x => x.Lot.LotNumber).ToList());
        Assert.Equal(["2"], LotSearch.Filter(all, new() { Classification = "Best" }).Select(x => x.Lot.LotNumber).ToList());
    }

    [Fact]
    public void Year_MatchesTheSaleYear()
    {
        var a = MakeLot("1", year: "2025");
        var b = MakeLot("2", year: "2026");
        var c = MakeLot("3", year: null);
        Assert.Equal(["2"], Nos(new() { Year = "2026" }, a, b, c));
    }

    // ---- everything together -----------------------------------------------------------------

    [Fact]
    public void AllFilters_AreAndedTogether_AndNoFiltersMeansEverything()
    {
        var a = MakeLot("1", new() { ["Broker"] = "ASC", ["Grade"] = "BOP" });
        var b = MakeLot("2", new() { ["Broker"] = "ASC", ["Grade"] = "OP" });
        var c = MakeLot("3", new() { ["Broker"] = "CT", ["Grade"] = "BOP" });
        var req = new LotSearchRequest { ColumnFilters = new() { ["Broker"] = Cat("ASC"), ["Grade"] = Cat("BOP") } };
        Assert.Equal(["1"], Nos(req, a, b, c));
        Assert.Equal(["1", "2", "3"], Nos(new(), a, b, c));
    }

    // ---- option lists ------------------------------------------------------------------------

    [Fact]
    public void Options_AreMostFrequentFirst_TiesAlphabetical_AndSkipEmptyColumns()
    {
        var lots = new[]
        {
            MakeLot("1", new() { ["Grade"] = "BOP" }), MakeLot("2", new() { ["Grade"] = "BOP" }), MakeLot("3", new() { ["Grade"] = "OP" }),
            MakeLot("4", new() { ["Grade"] = "FBOP" }), MakeLot("5", new() { ["Grade"] = "  " }),
        };
        var options = LotSearch.BuildOptions(lots, ["Grade", "Nothing"]);
        Assert.Equal(["BOP", "FBOP", "OP"], options["Grade"]);   // BOP x2, then FBOP / OP tied at 1, alphabetical
        Assert.False(options.ContainsKey("Nothing"));
    }

    [Fact]
    public void Options_LeaveOutAColumnWithFarTooManyDistinctValues()
    {
        var lots = Enumerable.Range(1, 50).Select(i => MakeLot(i.ToString(), new() { ["Remarks"] = "note " + i })).ToArray();
        Assert.False(LotSearch.BuildOptions(lots, ["Remarks"], maxDistinct: 10).ContainsKey("Remarks"));
        Assert.True(LotSearch.BuildOptions(lots, ["Remarks"], maxDistinct: 100).ContainsKey("Remarks"));
    }

    [Theory]
    [InlineData("1", "1")]
    [InlineData("01", "1")]
    [InlineData("001", "1")]
    [InlineData("  007 ", "7")]
    [InlineData("000", "0")]
    [InlineData("12A", "12a")]
    public void NormalizeLot_StripsLeadingZerosFromNumbers_AndIgnoresCaseOtherwise(string input, string expected) =>
        Assert.Equal(expected, LotSearch.NormalizeLot(input));

    [Fact]
    public void TypedLotNumbers_MatchWhateverPaddingTheFileUses()
    {
        var lots = new[] { MakeLot("1"), MakeLot("01"), MakeLot("001"), MakeLot("2"), MakeLot("12A") };
        // Typing "1" finds all three spellings of lot one; typing "002" finds lot 2; "12a" finds "12A".
        Assert.Equal(["1", "01", "001"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["1"] } } }, lots));
        Assert.Equal(["2"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["002"] } } }, lots));
        Assert.Equal(["12A"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["12a"] } } }, lots));
        Assert.Equal(["1", "01", "001", "2"], Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["01", "0002"] } } }, lots));
    }

    [Fact]
    public void ATypedLotThatIsNotInTheSale_MatchesNothing()
    {
        var lots = new[] { MakeLot("1"), MakeLot("2") };
        Assert.Empty(Nos(new() { ColumnFilters = new() { ["Lot No"] = new() { Kind = "lot", Values = ["999"] } } }, lots));
    }
}
