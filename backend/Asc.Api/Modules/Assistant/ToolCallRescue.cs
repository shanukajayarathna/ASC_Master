using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// Recovers a tool call that a model narrated as plain text instead of emitting through its
/// provider's real function-calling channel — smaller/quantized models do this under load
/// ('Here's the JSON: {"name":"mark_history","parameters":{...}}') and it used to reach the
/// user verbatim as raw JSON. Shared by every <see cref="IChatProvider"/> (OpenAI-compatible
/// and Gemini alike) so the fix applies no matter which vendor is on the other end.
/// </summary>
public static class ToolCallRescue
{
    /// <summary>Finds a tool-call JSON object ({"name":...,"parameters"/"arguments":...}) leaked
    /// into a plain-text reply, if it names a tool that actually exists. Returns null when the
    /// text is an ordinary answer — including when it merely happens to contain a JSON object
    /// with a "name" key that isn't a real tool.</summary>
    public static (string Name, string Arguments)? TryExtract(string content, IEnumerable<string> toolNames)
    {
        var start = Regex.Match(content, "\\{\\s*\"name\"\\s*:");
        if (!start.Success) return null;

        // Balance braces (string-aware) to find where the leaked object ends.
        var depth = 0; var end = -1; var inString = false; var escaped = false;
        for (var i = start.Index; i < content.Length; i++)
        {
            var c = content[i];
            if (escaped) { escaped = false; continue; }
            if (c == '\\') { escaped = true; continue; }
            if (c == '"') { inString = !inString; continue; }
            if (inString) continue;
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) { end = i; break; }
        }
        if (end < 0) return null;

        try
        {
            var node = JsonNode.Parse(content[start.Index..(end + 1)])?.AsObject();
            var name = node?["name"]?.GetValue<string>();
            if (name is null || toolNames.All(t => t != name)) return null;
            var args = node!["parameters"] ?? node["arguments"];
            return (name, args?.ToJsonString() ?? "{}");
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
