using System.Diagnostics;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// Resolves which <see cref="IChatProvider"/> serves a chat turn and reports which vendors are
/// configured — the seam between <see cref="AssistantController"/> and the concrete OpenAI/
/// Gemini/Groq providers. No routing intelligence beyond "requested key, or the default" —
/// deliberately, per the project's "don't over-engineer Auto mode yet" scoping. Never falls back
/// silently: an unknown or unconfigured provider always surfaces as a clean error to the caller.
/// </summary>
public class AiGateway(IEnumerable<IChatProvider> providers, ILogger<AiGateway> logger)
{
    private const string DefaultProviderKey = "openai";

    public IReadOnlyList<ProviderStatusDto> GetStatuses() => providers
        .Select(p => new ProviderStatusDto(p.Key, p.DisplayName, p.IsConfigured ? p.Model : null, p.IsConfigured))
        .ToList();

    public async Task<(string Reply, string ProviderKey)> CompleteAsync(
        string? requestedProviderKey,
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default)
    {
        var key = string.IsNullOrWhiteSpace(requestedProviderKey) || requestedProviderKey == "auto"
            ? DefaultProviderKey
            : requestedProviderKey;

        var provider = providers.FirstOrDefault(p => p.Key == key)
            ?? throw new ProviderUnavailableException($"Unknown AI provider '{key}'.");

        if (!provider.IsConfigured)
            throw new ProviderUnavailableException($"{provider.DisplayName} is not configured.");

        var sw = Stopwatch.StartNew();
        try
        {
            var reply = await provider.CompleteAsync(systemPrompt, history, tools, executeTool, ct);
            logger.LogInformation(
                "AI gateway call: provider={Provider} model={Model} durationMs={DurationMs} success=true",
                provider.Key, provider.Model, sw.ElapsedMilliseconds);
            return (reply, provider.Key);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex,
                "AI gateway call: provider={Provider} model={Model} durationMs={DurationMs} success=false",
                provider.Key, provider.Model, sw.ElapsedMilliseconds);
            throw new ProviderUnavailableException($"{provider.DisplayName} request failed: {ex.Message}");
        }
    }
}

public class ProviderUnavailableException(string message) : Exception(message);

public record ProviderStatusDto(string Key, string DisplayName, string? Model, bool Configured);
