using Asc.Api.Modules.Assistant;

namespace Asc.Api.Tests;

public class ToolCallRescueTests
{
    private static readonly string[] Tools = ["mark_history", "get_sale_breakdown", "scan_mark_performance"];

    [Fact]
    public void OrdinaryAnswer_NoLeakedCall_ReturnsNull()
    {
        Assert.Null(ToolCallRescue.TryExtract("Sale 30 of 2026 sold 5,155,050 kg at Rs. 1,167.42/kg.", Tools));
    }

    [Fact]
    public void LeakedCall_WithParametersKey_IsExtracted()
    {
        // The exact shape the user hit: a model narrating the call instead of using its
        // provider's real tool-calling channel.
        var content = "Here's a JSON for the function call:\n\n" +
            "{\"name\":\"mark_history\",\"parameters\":{\"mark\":\"CEYENTA\",\"yearFrom\":\"2023\",\"yearTo\":\"2026\"}}";

        var result = ToolCallRescue.TryExtract(content, Tools);

        Assert.NotNull(result);
        Assert.Equal("mark_history", result!.Value.Name);
        Assert.Contains("\"CEYENTA\"", result.Value.Arguments);
    }

    [Fact]
    public void LeakedCall_WithArgumentsKey_IsExtracted()
    {
        // Some models mirror the OpenAI wire field name ("arguments") instead of "parameters".
        var content = "{\"name\":\"get_sale_breakdown\",\"arguments\":{\"year\":\"2026\",\"saleNo\":\"30\",\"dimension\":\"broker\"}}";

        var result = ToolCallRescue.TryExtract(content, Tools);

        Assert.NotNull(result);
        Assert.Equal("get_sale_breakdown", result!.Value.Name);
        Assert.Contains("\"broker\"", result.Value.Arguments);
    }

    [Fact]
    public void UnknownToolName_IsNotRescued()
    {
        // A JSON object with a "name" key that isn't one of THIS agent's real tools must not be
        // treated as a call — e.g. incidental JSON the model is quoting for another reason.
        var content = "{\"name\":\"delete_everything\",\"parameters\":{}}";

        Assert.Null(ToolCallRescue.TryExtract(content, Tools));
    }

    [Fact]
    public void MalformedJson_DoesNotThrow_ReturnsNull()
    {
        var content = "{\"name\": \"mark_history\", \"parameters\": {mark: CEYENTA}"; // unquoted keys, no close

        Assert.Null(ToolCallRescue.TryExtract(content, Tools));
    }

    [Fact]
    public void NoArgumentsObject_DefaultsToEmptyObject()
    {
        var content = "{\"name\":\"mark_history\"}";

        var result = ToolCallRescue.TryExtract(content, Tools);

        Assert.NotNull(result);
        Assert.Equal("{}", result!.Value.Arguments);
    }

    [Fact]
    public void LeakedCall_EmbeddedMidSentence_IsStillFound()
    {
        var content = "Sure, let me look that up: {\"name\":\"scan_mark_performance\",\"parameters\":{\"mode\":\"recruit_leads\",\"broker\":\"ASC\"}} — one moment.";

        var result = ToolCallRescue.TryExtract(content, Tools);

        Assert.NotNull(result);
        Assert.Equal("scan_mark_performance", result!.Value.Name);
    }

    [Fact]
    public void BraceInsideStringValue_DoesNotConfuseBraceBalancing()
    {
        // A mark name or free-text argument containing a literal brace must not truncate the
        // object early — the string-aware balancer must track quotes, not just raw braces.
        var content = "{\"name\":\"mark_history\",\"parameters\":{\"mark\":\"ODD}MARK\"}}";

        var result = ToolCallRescue.TryExtract(content, Tools);

        Assert.NotNull(result);
        Assert.Contains("ODD}MARK", result!.Value.Arguments);
    }
}
