using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// Shared request/response handling for any vendor exposing an OpenAI-compatible
/// <c>/chat/completions</c> endpoint (same <c>messages</c>/<c>tools</c>/<c>tool_calls</c>/
/// <c>finish_reason</c> contract) — today that's OpenAI itself and Groq. A vendor with a
/// genuinely different wire format (e.g. Gemini) implements <see cref="IChatProvider"/> directly
/// instead of subclassing this.
/// </summary>
public abstract class OpenAiCompatibleChatProvider(HttpClient http, IConfiguration config) : IChatProvider
{
    // Bounds a single chat turn's tool-calling loop — read-only tools on modest data, five
    // round trips is generous headroom without risking a runaway loop.
    private const int MaxToolIterations = 5;

    public abstract string Key { get; }
    public abstract string DisplayName { get; }
    protected abstract string BaseUrl { get; }
    protected abstract string ApiKeyConfigKey { get; }
    protected abstract string ModelConfigKey { get; }
    protected abstract string DefaultModel { get; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(config[ApiKeyConfigKey]);

    public string Model => config[ModelConfigKey] ?? DefaultModel;

    public async Task<ChatCompletionResult> CompleteAsync(
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default)
    {
        var promptTokens = 0;
        var completionTokens = 0;
        var apiKey = config[ApiKeyConfigKey]
            ?? throw new InvalidOperationException(
                $"{ApiKeyConfigKey} is not configured. Set it with: dotnet user-secrets set {ApiKeyConfigKey} \"...\"");
        var model = Model;

        var messages = new JsonArray { new JsonObject { ["role"] = "system", ["content"] = systemPrompt } };
        foreach (var (role, content) in history)
            messages.Add(new JsonObject { ["role"] = role, ["content"] = content });

        var toolDefs = new JsonArray(tools.Select(t => (JsonNode)new JsonObject
        {
            ["type"] = "function",
            ["function"] = new JsonObject
            {
                ["name"] = t.Name,
                ["description"] = t.Description,
                ["parameters"] = JsonSerializer.SerializeToNode(t.ParametersSchema),
            },
        }).ToArray());

        for (var iteration = 0; iteration < MaxToolIterations; iteration++)
        {
            // JsonNode instances can only belong to one parent tree — clone before attaching
            // the shared `messages`/`toolDefs` arrays into this request's body.
            var requestBody = new JsonObject
            {
                ["model"] = model,
                ["messages"] = messages.DeepClone(),
                ["tools"] = toolDefs.DeepClone(),
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, BaseUrl)
            {
                Content = new StringContent(requestBody.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            using var res = await http.SendAsync(req, ct);
            var bodyText = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new InvalidOperationException($"{DisplayName} chat request failed ({(int)res.StatusCode}): {bodyText}");

            var parsed = JsonNode.Parse(bodyText)!;
            var message = parsed["choices"]![0]!["message"]!;
            var finishReason = parsed["choices"]![0]!["finish_reason"]!.GetValue<string>();

            promptTokens += parsed["usage"]?["prompt_tokens"]?.GetValue<int>() ?? 0;
            completionTokens += parsed["usage"]?["completion_tokens"]?.GetValue<int>() ?? 0;

            messages.Add(message.DeepClone());

            if (finishReason != "tool_calls")
                return new ChatCompletionResult(message["content"]?.GetValue<string>() ?? string.Empty, promptTokens, completionTokens);

            foreach (var call in message["tool_calls"]!.AsArray())
            {
                var toolCallId = call!["id"]!.GetValue<string>();
                var fnName = call["function"]!["name"]!.GetValue<string>();
                var fnArgs = call["function"]!["arguments"]!.GetValue<string>();
                var result = await executeTool(fnName, fnArgs);
                messages.Add(new JsonObject
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = toolCallId,
                    ["content"] = result,
                });
            }
        }

        return new ChatCompletionResult(
            "I wasn't able to finish that within the allotted tool calls — try rephrasing or narrowing the question.",
            promptTokens, completionTokens);
    }
}

public class OpenAiChatProvider(HttpClient http, IConfiguration config) : OpenAiCompatibleChatProvider(http, config)
{
    public override string Key => "openai";
    public override string DisplayName => "OpenAI";
    protected override string BaseUrl => "https://api.openai.com/v1/chat/completions";
    protected override string ApiKeyConfigKey => "OpenAI:ApiKey";
    protected override string ModelConfigKey => "OpenAI:ChatModel";
    protected override string DefaultModel => "gpt-5.1";
}

/// <summary>Groq exposes an OpenAI-compatible endpoint, so this is purely configuration on top of
/// <see cref="OpenAiCompatibleChatProvider"/> — no request/response handling to duplicate. Model
/// availability changes on Groq's side over time; if the configured <c>Groq:Model</c> names
/// something no longer served, the request fails with a clear upstream error rather than a
/// silent fallback.</summary>
public class GroqChatProvider(HttpClient http, IConfiguration config) : OpenAiCompatibleChatProvider(http, config)
{
    public override string Key => "groq";
    public override string DisplayName => "Groq";
    protected override string BaseUrl => "https://api.groq.com/openai/v1/chat/completions";
    protected override string ApiKeyConfigKey => "Groq:ApiKey";
    protected override string ModelConfigKey => "Groq:Model";
    protected override string DefaultModel => "llama-3.3-70b-versatile";
}
