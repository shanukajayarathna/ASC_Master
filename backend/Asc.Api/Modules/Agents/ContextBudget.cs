using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// Keeps what a language model is sent small. Every turn resends the conversation, so old chart JSON, old button lines and
/// long answers would be paid for again on every message. This keeps the last few real exchanges, drops the guided-dialogue
/// chatter (button questions and their taps — the resolved request already says what was chosen), and replaces chart blocks
/// with a one-line stub. Pure and deterministic.
/// </summary>
public static class ContextBudget
{
    public const int MaxTurns = 6;          // user/assistant pairs kept
    public const int MaxCharsPerTurn = 1500; // one old answer never costs more than this

    private static readonly Regex ChartBlock = new(@"```asc-chart[\s\S]*?```", RegexOptions.Compiled);
    private static readonly Regex ClarifyLine = new(@"^\s*CLARIFY:.*$", RegexOptions.Compiled | RegexOptions.Multiline);

    public static IReadOnlyList<(string Role, string Content)> Compact(IReadOnlyList<(string Role, string Content)> history)
    {
        var kept = new List<(string Role, string Content)>();
        foreach (var (role, content) in history)
        {
            if (role == "assistant")
            {
                // A question the chat asked itself, with its buttons, is not useful context to the model.
                if (content.Contains("CLARIFY:", StringComparison.Ordinal) && content.Length < 600) continue;
                var text = ClarifyLine.Replace(ChartBlock.Replace(content, "[chart shown earlier]"), "").Trim();
                if (text.Length > MaxCharsPerTurn) text = text[..MaxCharsPerTurn] + " …";
                if (text.Length == 0) continue;
                kept.Add((role, text));
            }
            else kept.Add((role, content.Length > MaxCharsPerTurn ? content[..MaxCharsPerTurn] + " …" : content));
        }

        // Keep the newest exchanges only; the current message is always the last entry.
        var limit = MaxTurns * 2;
        return kept.Count > limit ? kept.Skip(kept.Count - limit).ToList() : kept;
    }
}
