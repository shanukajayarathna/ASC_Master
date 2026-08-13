using System.Text.Json.Nodes;
using Asc.Api.Modules.Assistant;

namespace Asc.Api.Tests;

/// <summary>compare_sales argument tolerance — smaller models regularly send the id array in
/// the wrong shape (a JSON-encoded string, a comma list); ids are guids, so every shape below
/// must resolve to the same ids and garbage must yield an empty list, never a throw (a throw
/// here used to abort the whole chat turn).</summary>
public class ParseCatalogueIdsTests
{
    private static readonly Guid A = Guid.Parse("11111111-2222-3333-4444-555555555555");
    private static readonly Guid B = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    [Fact]
    public void WellFormedArray_Parses()
    {
        var node = JsonNode.Parse($"[\"{A}\", \"{B}\"]");
        Assert.Equal([A, B], AssistantToolExecutor.ParseCatalogueIds(node));
    }

    [Fact]
    public void JsonEncodedStringArray_Parses()
    {
        // The exact malformation observed from llama3.2: the array serialized as one string.
        var node = JsonValue.Create($"[\"{A}\", \"{B}\"]");
        Assert.Equal([A, B], AssistantToolExecutor.ParseCatalogueIds(node));
    }

    [Fact]
    public void CommaJoinedString_Parses()
    {
        var node = JsonValue.Create($"{A}, {B}");
        Assert.Equal([A, B], AssistantToolExecutor.ParseCatalogueIds(node));
    }

    [Fact]
    public void Garbage_YieldsEmptyList_NeverThrows()
    {
        Assert.Empty(AssistantToolExecutor.ParseCatalogueIds(JsonValue.Create("the last two sales")));
        Assert.Empty(AssistantToolExecutor.ParseCatalogueIds(null));
        Assert.Empty(AssistantToolExecutor.ParseCatalogueIds(JsonNode.Parse("[\"not-a-guid\"]")));
    }
}
