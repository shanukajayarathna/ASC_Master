using System.Text.Json;
using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Assistant;

/// <summary>Per-user assistant settings: which broker "we / our / my" means, and whether the assistant may use the
/// user's own history to personalise. Everything here concerns only the signed-in user.</summary>
public class AssistantPreferences
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; set; }

    /// <summary>Short broker code (ASC, BC, CT, EB, FW, JK, LC, MPB).</summary>
    public string MyBroker { get; set; } = DefaultBroker;

    public bool Personalise { get; set; } = true;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public const string DefaultBroker = "ASC";
    public static readonly IReadOnlyList<string> Brokers = ["ASC", "BC", "CT", "EB", "FW", "JK", "LC", "MPB"];
}

/// <summary>Who the assistant is talking to, as far as the user allows. Null everywhere when personalisation is off.</summary>
public record UserContext(string FirstName, string? Role, string MyBroker)
{
    /// <summary>The first word of a display name ("Shanuka Jayarathna" -> "Shanuka"); null for a blank one.</summary>
    public static string? FirstNameOf(string? displayName) =>
        (displayName ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();

    /// <summary>The prompt line that lets an agent resolve "we / our / my" and greet by name. Empty for no context.</summary>
    public static string PromptLine(UserContext? user) => user is null ? "" :
        $" The user is {user.FirstName}{(user.Role is { Length: > 0 } r ? $" ({r})" : "")}, who works for broker {user.MyBroker}. " +
        $"When they say \"we\", \"our\" or \"my\" about brokers, sales or volumes they mean {user.MyBroker} unless they name another. " +
        "This is background only: anything the user says in the question overrides it, and never invent facts about them.";
}

public enum SmallTalkKind { Greeting, Thanks, Help }

/// <summary>
/// Greetings, thanks and "what can you do" are answered by the server itself, instantly and without a language model — a
/// model has nothing useful to add, and a weak one can misread the context around a bare "hi". The reply can carry the
/// user's name and a few shortcuts from their own recent activity.
/// </summary>
public static class SmallTalk
{
    private static readonly Regex Greeting = new(@"^\s*(hi|hello|hey|hiya|hai|yo|greetings|ayubowan|vanakkam|good\s+(morning|afternoon|evening)|hi\s+there|hello\s+there|hey\s+there)(\s+(assistant|asc))?\s*[!.?,]*\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Thanks = new(@"^\s*((ok(ay)?[\s,]+)?(thanks|thank\s+you|thx|cheers|great[\s,]+thanks|thanks\s+a\s+lot)(\s+(assistant|asc))?)\s*[!.]*\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Help = new(@"^\s*(help|help\s+me|what\s+can\s+you\s+do|what\s+do\s+you\s+do|who\s+are\s+you|how\s+does\s+this\s+work|what\s+can\s+i\s+ask)\s*[?!.]*\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static SmallTalkKind? Match(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 60) return null;
        if (Greeting.IsMatch(text)) return SmallTalkKind.Greeting;
        if (Thanks.IsMatch(text)) return SmallTalkKind.Thanks;
        if (Help.IsMatch(text)) return SmallTalkKind.Help;
        return null;
    }

    /// <summary>Good morning / afternoon / evening from the reader's own local hour (0-23), or a plain hello.</summary>
    public static string Salutation(int? localHour) => localHour switch
    {
        >= 5 and <= 11 => "Good morning",
        >= 12 and <= 16 => "Good afternoon",
        >= 17 and <= 21 => "Good evening",
        _ => "Hello",
    };

    public const int MaxShortcuts = 4;
    private const int MaxShortcutChars = 60;

    private static readonly string[] Fallback =
        ["Compare brokers over the last 12 sales", "Show the top prices this sale", "What is the default penalty for a late buyer?", "Build a weekly broker report"];

    /// <summary>The chat message for a small-talk turn: the words, plus (for a greeting or help) one line of shortcuts the chat
    /// turns into tappable buttons. Shortcuts are the user's own recent questions first, padded with generic ones.</summary>
    public static string Reply(SmallTalkKind kind, string? firstName, int? localHour, IReadOnlyList<string> recentQuestions, int pinCount)
    {
        if (kind == SmallTalkKind.Thanks) return "You're welcome. Ask me anything else about prices, brokers, lots, by-laws or reports.";

        var shortcuts = recentQuestions.Where(q => q.Length is > 0 and <= MaxShortcutChars).Concat(Fallback)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxShortcuts).ToList();
        var lines = new List<string>();

        if (kind == SmallTalkKind.Help)
        {
            lines.Add("I can look up lots and valuations, compare brokers and grades over the archive, answer CTTA by-law questions, and build reports, Excel files and PowerPoint decks from what I find. Just ask in plain words — I'll ask a short question if I need to know more.");
        }
        else
        {
            var name = string.IsNullOrWhiteSpace(firstName) ? "" : $", {firstName}";
            lines.Add($"{Salutation(localHour)}{name}.");
            if (recentQuestions.Count > 0) lines.Add($"Last time you asked: “{recentQuestions[0]}”.");
            if (pinCount > 0) lines.Add($"You have {pinCount} pinned insight{(pinCount == 1 ? "" : "s")} in your library.");
        }

        var question = recentQuestions.Count > 0 ? "Where would you like to start?" : "What would you like to look at?";
        lines.Add(question);
        lines.Add($"CLARIFY: {JsonSerializer.Serialize(new { question, options = shortcuts })}");
        return string.Join("\n", lines);
    }

    /// <summary>Recent questions worth offering again: your own, distinct, not small talk, not too short.</summary>
    public static IReadOnlyList<string> WorthRepeating(IEnumerable<string> titles, int take = 3) =>
        [.. titles.Select(t => t.Trim()).Where(t => t.Length >= 10 && !t.EndsWith('…') && Match(t) is null).Distinct(StringComparer.OrdinalIgnoreCase).Take(take)];
}
