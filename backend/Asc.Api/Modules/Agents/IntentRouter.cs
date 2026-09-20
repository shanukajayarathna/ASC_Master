using System.Text.Json;
using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Agents;

/// <summary>What the universal assistant does with a message: answer it with <see cref="Agent"/>, or first ask one
/// short question (<see cref="Clarify"/>) because the request is too open to answer well.</summary>
public record RouteDecision(string Agent, ClarifyQuestion? Clarify, string Reason);

public record ClarifyQuestion(string Question, IReadOnlyList<string> Options);

/// <summary>
/// Chooses which agent answers a message in the single universal chat, and asks a clarifying question when an
/// analysis or report request is missing something it can't reasonably guess. Deliberately plain keyword rules, not
/// a model: routing costs nothing, behaves the same every time, and can be tested. Anything the rules don't
/// recognise goes to the General agent (or stays with the previous agent for a short follow-up), which handles
/// open questions and asks its own clarifying questions.
/// </summary>
public static class IntentRouter
{
    public const string Auto = "auto";

    /// <summary>At most this many router questions in a row before it just answers with sensible defaults.</summary>
    public const int MaxClarifications = 2;

    private static readonly Regex Bylaws = new(@"\b(by-?laws?|ctta|deposit|penalt(y|ies)|prompt day|debar|default(s|ed)?|claims?|storage charges?|objection)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Reports = new(@"\b(reports?|deck|powerpoint|power point|pptx|slides?|presentation|excel|spreadsheet|pdf|snapshot|export|schedule[d]?|weekly report)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Analytics = new(@"\b(trend|trends|compare|comparison|compared|over the last|last \d+ sales?|13 years|archive|histor(y|ical)|market share|share of|by broker|by grade|per sale|year on year|mark (performance|history)|tea ?board|average price|avg price|brokers?|grades?)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Auction = new(@"(\blot\s*#?\s*\d+|\b(lot number|valuation|valuations|valued|garden|gardens|catalogue|top prices?|top lots|highest price|this sale|current sale|liquor)\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex FollowUp = new(@"^(and|also|what about|how about|for|only|now|then|ok|okay|yes|no|show|make|same)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // What an analysis needs to be answerable: something to compare, and a period.
    private static readonly Regex HasSubject = new(@"\b(brokers?|grades?|origins?|elevations?|marks?|buyers?|gardens?|factor(y|ies)|sales?|weeks?|price ranges?|categories|category)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex HasPeriod = new(@"(\blast \d+|\blast (four|twelve|six|ten|week|month|year)|\bthis (year|week|month|sale)|\bcurrent (year|sale)|\blatest\b|\byear\b|\b20\d\d\b|\bsale \d+|\b13 years\b|\ball time\b|\bsince\b|\bweekly\b|\btrend\b|\bover time\b|\bper sale\b)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Vague = new(@"\b(compare|comparison|analy[sz]e|analysis|report|breakdown|share|performance)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <param name="previousAgent">The agent that answered (or is about to answer) the last turn; null at the start of a chat.</param>
    /// <param name="recentAssistantReplies">The last few assistant messages, newest last — used to see whether the last
    /// message was a clarifying question and how many were just asked.</param>
    /// <param name="previousUserMessage">The user message before this one — the request a clarifying question was about.</param>
    public static RouteDecision Decide(string message, string? previousAgent, IEnumerable<string>? recentAssistantReplies = null, string? previousUserMessage = null)
    {
        var text = (message ?? "").Trim();
        var words = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var prev = previousAgent is "general" or "auction" or "analytics" or "reports" ? previousAgent : null;
        var replies = (recentAssistantReplies ?? []).ToList();
        var askedInARow = replies.TakeLast(MaxClarifications).Count(r => r.Contains("CLARIFY:", StringComparison.Ordinal));

        // A short reply to the question we just asked ("Brokers", "Last 12 sales") continues that request: judge the two
        // together, so a second missing detail can still be asked for, then answer with the same agent.
        var answeredOurQuestion = replies.TakeLast(1).Any(r => r.Contains("CLARIFY:", StringComparison.Ordinal)) && prev is not null && words <= 6;
        if (answeredOurQuestion)
        {
            var combined = $"{previousUserMessage} {text}".Trim();
            if (askedInARow < MaxClarifications && Clarify(combined, prev!, null) is { } more)
                return new RouteDecision(prev!, more, "still needs a detail");
            return new RouteDecision(prev!, null, "answer to a clarifying question");
        }

        var agent = Classify(text, words, prev, out var reason);
        if (askedInARow < MaxClarifications && Clarify(text, agent, prev) is { } q)
            return new RouteDecision(agent, q, reason + " (needs clarification)");

        return new RouteDecision(agent, null, reason);
    }

    private static string Classify(string text, int words, string? prev, out string reason)
    {
        if (Bylaws.IsMatch(text)) { reason = "by-laws question"; return "general"; }
        if (Reports.IsMatch(text)) { reason = "report or export request"; return "reports"; }
        if (Auction.IsMatch(text) && !Analytics.IsMatch(text)) { reason = "lot or valuation question"; return "auction"; }
        if (Analytics.IsMatch(text)) { reason = "comparison or archive analysis"; return "analytics"; }
        if (Auction.IsMatch(text)) { reason = "lot or valuation question"; return "auction"; }
        if (prev is not null && (words <= 8 || FollowUp.IsMatch(text))) { reason = "follow-up to the previous answer"; return prev; }
        reason = "general question";
        return "general";
    }

    /// <summary>The single question to ask first, or null when the request is specific enough to answer.</summary>
    private static ClarifyQuestion? Clarify(string text, string agent, string? prev)
    {
        if (agent is not ("analytics" or "reports")) return null;
        // A short reply continuing the same agent's thread is an answer or refinement, not a new open request.
        if (prev == agent && text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length <= 4) return null;
        if (!Vague.IsMatch(text)) return null;

        if (!HasSubject.IsMatch(text))
            return new ClarifyQuestion("What should I compare?", ["Brokers", "Grades", "Sales over time"]);
        if (!HasPeriod.IsMatch(text))
            return new ClarifyQuestion("Over which period?", ["Last 4 sales", "Last 12 sales", "This year"]);
        return null;
    }

    /// <summary>The assistant message that carries a clarifying question: a short lead-in plus the machine line the chat turns into buttons.</summary>
    public static string ClarifyReply(ClarifyQuestion q) =>
        $"{q.Question}\nCLARIFY: {JsonSerializer.Serialize(new { question = q.Question, options = q.Options })}";
}
