using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Asc.Api.Modules.Assistant;

public record ToolDef(string Name, string Description, object ParametersSchema);

/// <summary>
/// The chat seam — same swap-later shape as <see cref="Asc.Api.Modules.Documents.IEmbeddingProvider"/>.
/// OpenAI today (per the project's choice — Claude has no bearing on this decision, it's a
/// separate vendor from whatever embeds documents in Phase 3... which is also OpenAI here).
/// </summary>
public interface IChatProvider
{
    Task<string> CompleteAsync(
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default);
}

public class OpenAiChatProvider(HttpClient http, IConfiguration config) : IChatProvider
{
    // Bounds a single chat turn's tool-calling loop — read-only tools on modest data, five
    // round trips is generous headroom without risking a runaway loop.
    private const int MaxToolIterations = 5;

    public async Task<string> CompleteAsync(
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default)
    {
        var apiKey = config["OpenAI:ApiKey"]
            ?? throw new InvalidOperationException(
                "OpenAI:ApiKey is not configured. Set it with: dotnet user-secrets set OpenAI:ApiKey \"sk-...\"");
        var model = config["OpenAI:ChatModel"] ?? "gpt-5.1";

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

            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions")
            {
                Content = new StringContent(requestBody.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            using var res = await http.SendAsync(req, ct);
            var bodyText = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new InvalidOperationException($"OpenAI chat request failed ({(int)res.StatusCode}): {bodyText}");

            var parsed = JsonNode.Parse(bodyText)!;
            var message = parsed["choices"]![0]!["message"]!;
            var finishReason = parsed["choices"]![0]!["finish_reason"]!.GetValue<string>();

            messages.Add(message.DeepClone());

            if (finishReason != "tool_calls")
                return message["content"]?.GetValue<string>() ?? string.Empty;

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

        return "I wasn't able to finish that within the allotted tool calls — try rephrasing or narrowing the question.";
    }
}
