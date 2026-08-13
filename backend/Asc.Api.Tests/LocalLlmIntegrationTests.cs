using Asc.Api.Modules.Assistant;
using Microsoft.Extensions.Configuration;

namespace Asc.Api.Tests;

/// <summary>
/// Marks a test that talks to a real local LLM. Runs only when Ollama is reachable on
/// localhost:11434 AND the test model is installed — skipped (not failed) otherwise, so the
/// suite stays green on CI and on machines without Ollama. The probe runs once per test run.
/// </summary>
public sealed class LocalLlmFactAttribute : FactAttribute
{
    public const string Model = "llama3.2";

    private static readonly string? SkipReason = Probe();

    public LocalLlmFactAttribute()
    {
        if (SkipReason is not null) Skip = SkipReason;
    }

    private static string? Probe()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var tags = http.GetStringAsync("http://localhost:11434/api/tags").GetAwaiter().GetResult();
            return tags.Contains(Model)
                ? null
                : $"Ollama is running but '{Model}' is not installed — run: ollama pull {Model}";
        }
        catch
        {
            return "Ollama is not running on localhost:11434 — start it to run local-LLM integration tests.";
        }
    }
}

/// <summary>
/// Real end-to-end tests of the OpenAI-compatible chat pipeline against a local model — the
/// request building, tool-calling loop, tool-result round-trip and usage accounting that unit
/// tests can only mock. Free to run (no API key, no network egress), which is exactly why the
/// local provider exists. Assertions are deliberately loose about wording (an LLM's phrasing
/// is not a contract) and strict about the mechanics: was the tool really called, with the
/// argument we supplied, and did the model's answer use the value the tool actually returned.
/// </summary>
public class LocalLlmIntegrationTests
{
    private static LocalChatProvider Provider() => new(
        new HttpClient { Timeout = TimeSpan.FromMinutes(5) },
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Local:Model"] = LocalLlmFactAttribute.Model })
            .Build());

    [LocalLlmFact]
    public async Task PlainCompletion_ReturnsAReply_AndCountsTokens()
    {
        var result = await Provider().CompleteAsync(
            "You are a test assistant. Answer in one short sentence.",
            [("user", "Say hello.")],
            tools: [],
            executeTool: (_, _) => throw new InvalidOperationException("no tool should be called"));

        Assert.False(string.IsNullOrWhiteSpace(result.Reply));
        Assert.True(result.PromptTokens > 0, "prompt tokens should be reported");
        Assert.True(result.CompletionTokens > 0, "completion tokens should be reported");
    }

    [LocalLlmFact]
    public async Task ToolLoop_CallsTheTool_AndAnswersFromItsRealResult()
    {
        var toolCalls = new List<(string Name, string Args)>();

        var tools = new List<ToolDef>
        {
            new(
                "get_top_price",
                "Get the highest settled auction price for a catalogue.",
                new
                {
                    type = "object",
                    properties = new { catalogueId = new { type = "string", description = "The catalogue id." } },
                    required = new[] { "catalogueId" },
                }),
        };

        var result = await Provider().CompleteAsync(
            "You are an auction data assistant. Use the tools to answer; never invent numbers.",
            [("user", "What is the highest price in catalogue abc-123? Use the get_top_price tool.")],
            tools,
            executeTool: (name, args) =>
            {
                toolCalls.Add((name, args));
                return Task.FromResult("""{"topPrice": 4242.50, "lotNo": "77", "currency": "LKR"}""");
            });

        // The mechanics that matter: exactly this tool was really invoked, with the catalogue
        // id from the question, and the reply carries the price only the tool could have known.
        Assert.NotEmpty(toolCalls);
        Assert.All(toolCalls, c => Assert.Equal("get_top_price", c.Name));
        Assert.Contains("abc-123", toolCalls[0].Args);
        Assert.Contains("4242", result.Reply.Replace(",", ""));
    }
}
