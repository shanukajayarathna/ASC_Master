using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class AnswerVerifierTests
{
    private const string Tool = "{\"datasetId\":\"ab12\",\"scope\":\"ASC only · sale 32/2026\",\"markdownTable\":\"| Grade | Qty |\n| BOPF | 1,234,567 |\n| BOP | 987,654 |\n| Avg | 1,250.50 |\"}";

    [Fact]
    public void FiguresThatComeFromTheToolResult_AreFine_HoweverTheyAreWritten()
    {
        Assert.Empty(AnswerVerifier.Unverified("BOPF sold 1,234,567 kg at Rs. 1,250.50/kg; BOP sold 987654 kg.", [Tool]));
        Assert.Empty(AnswerVerifier.Unverified("About Rs 1,251/kg on average.", [Tool]));       // rounding within half a percent
    }

    [Fact]
    public void AFigureTheDataDoesNotContain_IsListed()
    {
        var bad = AnswerVerifier.Unverified("BOPF sold 1,234,567 kg but total proceeds were Rs 45,678,900.", [Tool]);
        Assert.Equal(["45,678,900"], bad);
    }

    [Fact]
    public void SmallNumbers_Years_SaleNumbers_ScopeLines_AndChartBlocks_AreNotChecked()
    {
        var reply = "Sale 32/2026 had 12 lots, 23.4% share, rank 3.\nScope: 2025 · 99,999 kg\n```asc-chart\n{\"values\":[777777]}\n```";
        Assert.Empty(AnswerVerifier.Unverified(reply, [Tool]));
        Assert.Empty(AnswerVerifier.Unverified("In 2026 prices rose.", []));
    }

    [Fact]
    public void WithNoToolUsedAtAll_AnyLargeFigureIsUnbacked_AndSaidSo()
    {
        var text = AnswerVerifier.Annotate("ASC averaged Rs 1,250 per kg.", []);
        Assert.Contains("⚠ Check these figures (1,250)", text);
        Assert.Contains("not based on a data lookup", text);
    }

    [Fact]
    public void TheCaution_GoesAboveTheTappableQuestion_AndIsCappedAtFiveFigures()
    {
        var reply = "Values 11,111 22,222 33,333 44,444 55,555 66,666 kg.\nCLARIFY: {\"question\":\"Next?\",\"options\":[\"a\",\"b\"]}";
        var text = AnswerVerifier.Annotate(reply, [Tool]);
        Assert.True(text.IndexOf("⚠", StringComparison.Ordinal) < text.IndexOf("CLARIFY:", StringComparison.Ordinal));
        Assert.EndsWith("\"options\":[\"a\",\"b\"]}", text);
        Assert.Contains("55,555, …", text);
        Assert.DoesNotContain("66,666", text[text.IndexOf("⚠", StringComparison.Ordinal)..]);
        Assert.Contains("couldn't match them", text);
    }

    [Fact]
    public void ACleanAnswer_IsReturnedUntouched()
    {
        const string reply = "BOPF led with 1,234,567 kg.";
        Assert.Same(reply, AnswerVerifier.Annotate(reply, [Tool]));
    }
}

public class NarratedToolCallTests
{
    [Theory]
    [InlineData("I will call list_catalogues to get the catalogue id.")]
    [InlineData("Please call list_catalogues to get a real catalogue id.")]
    [InlineData("Let me run get_factory_codes first.")]
    public void APlanToCallATool_WithNoToolResult_IsCaught(string reply) => Assert.True(AnswerVerifier.IsNarratedToolCall(reply, []));

    [Fact]
    public void AToolThatRan_OrAnOrdinaryAnswer_IsNotCaught()
    {
        Assert.False(AnswerVerifier.IsNarratedToolCall("Call list_catalogues to get the id.", ["{\"ok\":true}"]));
        Assert.False(AnswerVerifier.IsNarratedToolCall("The MF code is 0412.", []));
    }
}
