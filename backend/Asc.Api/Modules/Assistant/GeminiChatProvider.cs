using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// Google Generative Language API (v1beta <c>generateContent</c>) — a genuinely different wire
/// format from the OpenAI-compatible providers (system instruction is its own top-level field,
/// not a message role; roles are "user"/"model" not "user"/"assistant"; tool results go back as
/// a "functionResponse" part rather than a "tool" role message), so this implements
/// <see cref="IChatProvider"/> directly instead of going through
/// <see cref="OpenAiCompatibleChatProvider"/>. It drives the exact same <c>tools</c>/
/// <c>executeTool</c> seam as every other provider, so the ASC business tools underneath never
/// know a different vendor is calling them.
/// </summary>
public class GeminiChatProvider(HttpClient http, IConfiguration config) : IChatProvider
{
    // Same bound as the OpenAI-compatible providers — see OpenAiCompatibleChatProvider's comment.
    private const int MaxToolIterations = 5;

    public string Key => "gemini";
    public string DisplayName => "Gemini";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(config["Gemini:ApiKey"]);
    public string Model => config["Gemini:Model"] ?? "gemini-flash-latest";

    public async Task<string> CompleteAsync(
        string systemPrompt,
        IReadOnlyList<(string Role, string Content)> history,
        IReadOnlyList<ToolDef> tools,
        Func<string, string, Task<string>> executeTool,
        CancellationToken ct = default)
    {
        var apiKey = config["Gemini:ApiKey"]
            ?? throw new InvalidOperationException(
                "Gemini:ApiKey is not configured. Set it with: dotnet user-secrets set Gemini:ApiKey \"...\"");
        var model = Model;

        var contents = new JsonArray();
        foreach (var (role, content) in history)
        {
            contents.Add(new JsonObject
            {
                // Gemini's own roles: the model's prior turns are "model", everything else is "user".
                ["role"] = role == "assistant" ? "model" : "user",
                ["parts"] = new JsonArray { new JsonObject { ["text"] = content } },
            });
        }

        var functionDeclarations = new JsonArray(tools.Select(t => (JsonNode)new JsonObject
        {
            ["name"] = t.Name,
            ["description"] = t.Description,
            ["parameters"] = JsonSerializer.SerializeToNode(t.ParametersSchema),
        }).ToArray());

        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent";

        for (var iteration = 0; iteration < MaxToolIterations; iteration++)
        {
            var requestBody = new JsonObject
            {
                ["systemInstruction"] = new JsonObject { ["parts"] = new JsonArray { new JsonObject { ["text"] = systemPrompt } } },
                ["contents"] = contents.DeepClone(),
                ["tools"] = new JsonArray { new JsonObject { ["functionDeclarations"] = functionDeclarations.DeepClone() } },
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(requestBody.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            // Header, not a query-string key, so it never lands in access logs or proxy history.
            req.Headers.Add("x-goog-api-key", apiKey);

            using var res = await http.SendAsync(req, ct);
            var bodyText = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new InvalidOperationException($"Gemini chat request failed ({(int)res.StatusCode}): {bodyText}");

            var parsed = JsonNode.Parse(bodyText)!;
            var candidate = parsed["candidates"]?[0];
            var contentNode = candidate?["content"];
            var parts = contentNode?["parts"]?.AsArray() ?? [];

            var functionCalls = parts.Where(p => p!["functionCall"] is not null).ToList();

            if (functionCalls.Count == 0)
            {
                var text = string.Concat(parts.Select(p => p!["text"]?.GetValue<string>() ?? string.Empty));
                return text;
            }

            // Echo the model's own turn back into history before appending the tool results, so
            // Gemini sees its own call on the next turn. contentNode is already a full
            // {"role":"model","parts":[...]} entry — clone it as-is, don't re-wrap it.
            contents.Add(contentNode!.DeepClone());

            var responseParts = new JsonArray();
            foreach (var call in functionCalls)
            {
                var fnName = call!["functionCall"]!["name"]!.GetValue<string>();
                var argsNode = call["functionCall"]!["args"];
                var argsJson = argsNode?.ToJsonString() ?? "{}";
                var resultJson = await executeTool(fnName, argsJson);

                responseParts.Add(new JsonObject
                {
                    ["functionResponse"] = new JsonObject
                    {
                        ["name"] = fnName,
                        ["response"] = JsonNode.Parse(resultJson) is JsonObject resultObj
                            ? resultObj
                            : new JsonObject { ["result"] = JsonNode.Parse(resultJson) },
                    },
                });
            }

            contents.Add(new JsonObject { ["role"] = "user", ["parts"] = responseParts });
        }

        return "I wasn't able to finish that within the allotted tool calls — try rephrasing or narrowing the question.";
    }
}
