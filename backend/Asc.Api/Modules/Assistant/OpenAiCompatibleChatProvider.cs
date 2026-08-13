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

    /// <summary>False for a local endpoint (Ollama and friends accept unauthenticated requests);
    /// hosted vendors keep the default. When false, a placeholder bearer token is sent — harmless
    /// to servers that ignore the Authorization header entirely.</summary>
    protected virtual bool RequiresApiKey => true;

    /// <summary>Vendor hook to adjust the request body before sending (e.g. pin sampling
    /// parameters). Default: no change — hosted vendors get their own server-side defaults.</summary>
    protected virtual void CustomizeRequestBody(JsonObject body) { }

    public virtual bool IsConfigured => !RequiresApiKey || !string.IsNullOrWhiteSpace(config[ApiKeyConfigKey]);

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
            ?? (RequiresApiKey
                ? throw new InvalidOperationException(
                    $"{ApiKeyConfigKey} is not configured. Set it with: dotnet user-secrets set {ApiKeyConfigKey} \"...\"")
                : "not-needed");
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
            CustomizeRequestBody(requestBody);

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
                string result;
                try
                {
                    result = await executeTool(fnName, fnArgs);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    // A malformed tool call (wrong arg type, bad guid, missing field — local
                    // models produce these regularly, hosted ones occasionally) used to abort
                    // the whole chat turn from here. Feeding the failure back as the tool's
                    // result instead gives the model the standard chance to correct itself and
                    // retry — the same contract as a tool returning {"error": ...} on its own.
                    result = JsonSerializer.Serialize(new { error = $"Tool call failed: {ex.Message}. Check the argument types against the tool's schema and try again." });
                }
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

/// <summary>
/// A locally hosted model for development/testing — no API key, no network egress, no per-token
/// cost. Points at any server exposing the OpenAI <c>/chat/completions</c> contract; the default
/// URL is Ollama's (<c>ollama pull llama3.1 && ollama serve</c>, then set <c>Local:Model</c>), and
/// LM Studio/vLLM/llama.cpp work by overriding <c>Local:BaseUrl</c>. Configured means
/// <c>Local:Model</c> is set — an explicit opt-in, so this never lists as available in an
/// environment that hasn't chosen it, and the picked model must support tool calling (e.g.
/// llama3.1/3.2, qwen2.5) or every assistant question will come back tool-blind. If the server
/// isn't actually running, requests fail with the gateway's normal clean provider error — never
/// a silent fallback to a hosted vendor.
/// </summary>
public class LocalChatProvider(HttpClient http, IConfiguration config) : OpenAiCompatibleChatProvider(http, config)
{
    public override string Key => "local";
    public override string DisplayName => "Local (Ollama) — testing only";
    protected override string BaseUrl => config["Local:BaseUrl"] ?? "http://localhost:11434/v1/chat/completions";
    protected override string ApiKeyConfigKey => "Local:ApiKey";
    protected override string ModelConfigKey => "Local:Model";
    protected override string DefaultModel => "llama3.1";
    protected override bool RequiresApiKey => false;

    public override bool IsConfigured => !string.IsNullOrWhiteSpace(config["Local:Model"]);

    /// <summary>Greedy decoding for the local model: small models' tool-calling falls apart at
    /// Ollama's default sampling temperature (verified directly against llama3.2 — flaky
    /// content-instead-of-tool_calls responses at the 0.8 default, consistent correct tool
    /// calls at 0). Hosted vendors are far less sensitive and keep their own defaults.</summary>
    protected override void CustomizeRequestBody(JsonObject body) => body["temperature"] = 0;
}
