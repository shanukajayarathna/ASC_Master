using System.Globalization;
using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// A last check on a model-written answer: every larger figure in it (a price, a quantity, proceeds) must appear in the data
/// the tools returned during the same turn. A figure the model invented, mistyped or computed on its own is listed in a
/// short caution under the answer, so nobody relies on it unknowingly. Pure and deterministic; it never edits the answer's
/// own words, only adds the caution.
/// </summary>
public static class AnswerVerifier
{
    private static readonly Regex Number = new(@"(?<![\w/.\-])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?", RegexOptions.Compiled);
    private static readonly Regex ChartBlock = new(@"```asc-chart[\s\S]*?```", RegexOptions.Compiled);
    private static readonly Regex ClarifyLine = new(@"^\s*CLARIFY:.*$", RegexOptions.Compiled | RegexOptions.Multiline);
    private static readonly Regex ScopeLine = new(@"^\s*Scope:.*$", RegexOptions.Compiled | RegexOptions.Multiline | RegexOptions.IgnoreCase);

    private const decimal MinChecked = 1000m;   // small numbers (counts, percentages, ranks) are too often derived legitimately
    public const int MaxListed = 5;

    private static IEnumerable<(decimal Value, string Text, bool Plain)> Numbers(string text)
    {
        foreach (Match m in Number.Matches(text))
        {
            var raw = m.Groups[1].Value + m.Groups[2].Value;
            if (!decimal.TryParse(raw.Replace(",", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var v)) continue;
            yield return (v, m.Value, !m.Groups[1].Value.Contains(',') && !m.Groups[2].Success);
        }
    }

    private static bool Matches(decimal figure, IReadOnlyList<decimal> known) =>
        known.Any(k => Math.Abs(k - figure) <= Math.Max(1m, Math.Abs(figure) * 0.005m));

    /// <summary>The figures in <paramref name="reply"/> that no tool result contains (within rounding).</summary>
    public static IReadOnlyList<string> Unverified(string reply, IReadOnlyList<string> toolOutputs)
    {
        var body = ScopeLine.Replace(ClarifyLine.Replace(ChartBlock.Replace(reply ?? "", " "), " "), " ");
        var known = toolOutputs.SelectMany(o => Numbers(o).Select(n => n.Value)).Distinct().ToList();
        var flagged = new List<string>();
        foreach (var (value, text, plain) in Numbers(body))
        {
            if (value < MinChecked) continue;
            if (plain && value is >= 1900 and <= 2100) continue;          // a year
            if (Matches(value, known) || flagged.Contains(text)) continue;
            flagged.Add(text);
        }
        return flagged;
    }

    private static readonly Regex NarratedCall = new(@"\b(call|invoke|use|run)\s+(the\s+)?(list_[a-z_]+|get_[a-z_]+|search_[a-z_]+|query_data|make_chart|generate_[a-z_]+|scan_[a-z_]+|compare_sales|mark_[a-z_]+)\b|\b(list_catalogues|list_sales|query_data|search_lots|get_[a-z]+_[a-z_]+)\b\s*(\(|with\b|returned\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>True when the reply tells the reader to call a tool (or names one) with no tool result behind it: a plan, not an answer.</summary>
    public static bool IsNarratedToolCall(string reply, IReadOnlyList<string> toolOutputs) =>
        toolOutputs.Count == 0 && NarratedCall.IsMatch(reply ?? "");

    public const string CouldNotLookUp = "I couldn't look that up just now, so there is no figure to give you. Please ask again; if it keeps happening, name the sale and the factory's full name.";

    /// <summary>The reply with a caution added (above any tappable CLARIFY line) when it holds figures the data doesn't back.</summary>
    public static string Annotate(string reply, IReadOnlyList<string> toolOutputs)
    {
        var flagged = Unverified(reply, toolOutputs);
        if (flagged.Count == 0) return reply;

        var listed = string.Join(", ", flagged.Take(MaxListed)) + (flagged.Count > MaxListed ? ", …" : "");
        var caution = toolOutputs.Count == 0
            ? $"⚠ Check these figures ({listed}): this answer was not based on a data lookup."
            : $"⚠ Check these figures ({listed}): I couldn't match them to the data I retrieved.";

        var clarify = ClarifyLine.Match(reply);
        return clarify.Success
            ? reply[..clarify.Index].TrimEnd() + "\n\n" + caution + "\n" + clarify.Value.TrimStart()
            : reply.TrimEnd() + "\n\n" + caution;
    }
}
