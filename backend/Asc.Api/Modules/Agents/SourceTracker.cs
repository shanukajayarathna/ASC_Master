using System.Text.Json;

namespace Asc.Api.Modules.Agents;

/// <summary>Where an answer's figures came from, for the chat's "Source" chips. Kind is a stable machine value
/// (bylaws | archive | catalogue | saved | report | file); Detail carries the specific part when there is one
/// (for the by-laws, the section title, which the chip lets the reader open).</summary>
public record ChatSource(string Kind, string Label, string? Detail = null);

/// <summary>
/// Records which tools an agent actually used while answering and turns them into <see cref="ChatSource"/>s. A tool
/// that returned an error is not a source — nothing was read. The mapping is deterministic from the tool name and
/// result, never from the model's own claims about where it got something.
/// </summary>
public sealed class SourceTracker
{
    private readonly List<(string Tool, string Args, string Result)> _calls = [];
    private readonly Lock _gate = new();

    /// <summary>Wraps an agent's tool dispatcher so every call is noted.</summary>
    public Func<string, string, Task<string>> Wrap(Func<string, string, Task<string>> inner) => async (name, args) =>
    {
        var result = await inner(name, args);
        lock (_gate) _calls.Add((name, args, result));
        return result;
    };

    public IReadOnlyList<ChatSource> ToSources()
    {
        lock (_gate) return SourcesFor(_calls);
    }

    private static readonly HashSet<string> ArchiveTools = new(StringComparer.Ordinal)
    {
        "query_data", "make_chart", "list_sales", "get_sale_breakdown", "compare_sales", "mark_broker_history",
        "scan_mark_performance", "get_teaboard_averages", "get_sale_summary",
    };

    private static bool IsError(string result) => result.TrimStart().StartsWith("{\"error\"", StringComparison.Ordinal);

    /// <summary>Pure mapping from tool calls to sources, in order of first use, without duplicates.</summary>
    public static IReadOnlyList<ChatSource> SourcesFor(IEnumerable<(string Tool, string Args, string Result)> calls)
    {
        var sources = new List<ChatSource>();
        void Add(ChatSource s)
        {
            if (!sources.Contains(s)) sources.Add(s);
        }

        foreach (var (tool, _, result) in calls)
        {
            if (IsError(result)) continue;
            if (tool == CttaBylawsTool.Name)
            {
                Add(new ChatSource("bylaws", "CTTA By-Laws", FirstMatchedSection(result)));
            }
            else if (tool.StartsWith("generate_", StringComparison.Ordinal))
            {
                Add(new ChatSource("file", "Generated file"));
            }
            else if (tool is "list_saved_reports" or "get_saved_report")
            {
                Add(new ChatSource("saved", "Saved reports"));
            }
            else if (ArchiveTools.Contains(tool))
            {
                Add(new ChatSource("archive", "MSL auction archive"));
            }
            else
            {
                Add(new ChatSource("catalogue", "Sale catalogue data"));
            }
        }
        return sources;
    }

    /// <summary>The title of the first by-laws section the lookup matched, or null when only the constants came back.</summary>
    internal static string? FirstMatchedSection(string toolResult)
    {
        try
        {
            using var doc = JsonDocument.Parse(toolResult);
            if (doc.RootElement.TryGetProperty("matchedSections", out var m) && m.ValueKind == JsonValueKind.Array && m.GetArrayLength() > 0)
                return m[0].GetString();
        }
        catch (JsonException)
        {
            // Not JSON: no specific section to cite.
        }
        return null;
    }
}
