namespace Asc.Api.Modules.Assistant;

public record ToolDef(string Name, string Description, object ParametersSchema, bool RequiresAdmin = false);

/// <summary>Token counts are summed across every round trip of a single CompleteAsync call,
/// including tool-calling iterations — each is a separate upstream request with its own usage
/// block. Zero when a provider's usage field is missing or unparsable, never a guess.</summary>
public record ChatCompletionResult(string Reply, int PromptTokens, int CompletionTokens);

/// <summary>
/// The chat seam — same swap-later shape as <see cref="Asc.Api.Modules.Documents.IEmbeddingProvider"/>.
/// Multiple vendors implement this behind the AI Gateway (<see cref="AiGateway"/>): OpenAI
/// (<see cref="OpenAiChatProvider"/>), Groq (<see cref="GroqChatProvider"/>) — both OpenAI-wire-format,
/// sharing <see cref="OpenAiCompatibleChatProvider"/> — and Gemini (<see cref="GeminiChatProvider"/>),
/// which has its own wire format entirely. Whichever vendor is used, it drives the exact same
/// <c>tools</c>/<c>executeTool</c> seam, so the ASC business tools and Knowledge Base search never know
/// or care which provider is asking.
/// </summary>
public interface IChatProvider
{
    /// <summary>Stable identifier used in API requests/responses and DI lookup, e.g. "openai".</summary>
    string Key { get; }

    /// <summary>Human-readable name for status/UI, e.g. "OpenAI".</summary>
    string DisplayName { get; }

    /// <summary>True once this provider's API key is present in configuration.</summary>
    bool IsConfigured { get; }

    /// <summary>The configured (or default) model name — never a secret, safe to expose.</summary>
    string Model { get; }

    Task<ChatCompletionResult> CompleteAsync(
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default);
}
