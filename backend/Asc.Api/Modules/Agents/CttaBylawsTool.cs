using System.Text.Encodings.Web;
using System.Text.Json;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Knowledge;

namespace Asc.Api.Modules.Agents;

/// <summary>
/// get_ctta_bylaws — the one tool every agent carries, so a question about auction rules
/// (deposits, prompt day, defaults, storage, claims...) gets the same grounded answer whichever
/// agent the user picked. Attached by each agent next to its own executor's tools rather than
/// added to any executor's Definitions list, so those curated tool sets stay exactly as they are
/// and a missing registration simply leaves an agent without it.
/// </summary>
public class CttaBylawsTool(ICttaBylawsService bylaws, ILogger<CttaBylawsTool> logger)
{
    public const string Name = "get_ctta_bylaws";

    public static readonly ToolDef Definition = new(
        Name,
        "Look up the CTTA By-Laws and Conditions of Sale (Ceylon Chamber of Commerce, adopted 30 June 2023) — the " +
        "rules governing Colombo tea auctions and private treaty sales. Covers: roles & eligibility; teas offered & " +
        "minimum quality standard; warehousing; packing & cataloguing (break sizes); sampling; auction procedure & rate " +
        "of advancing bids; payment, deposits, prompt day, default penalties & debarment; delivery (ex-Colombo, " +
        "ex-estate); risk & storage charges; lost delivery orders; objections, complaints & claims; agency; mediation & " +
        "arbitration; amendment & suspension; EDO registration. Always returns the key-constants table plus the " +
        "section(s) best matching the topic. Use it for ANY question about auction rules, deadlines, penalties, or " +
        "charges — never answer those from memory.",
        new
        {
            type = "object",
            properties = new
            {
                topic = new
                {
                    type = "string",
                    description = "What the user is asking about, e.g. 'buyer deposit', 'third payment default', " +
                        "'storage charges', 'quality complaint deadline', or a section name from availableSections.",
                },
            },
            required = new[] { "topic" },
        });

    public const string PromptInstructions =
        " CTTA AUCTION RULES: for any question about the rules of the Colombo tea auction — deposits, prompt day, " +
        "payment deadlines, default penalties or debarment, delivery deadlines, storage charges or risk, cataloguing or " +
        "bidding rules, quality standards, complaints and claims, arbitration — call get_ctta_bylaws (this is in scope " +
        "for every agent, whatever its specialty) and answer only from the text it returns: copy figures exactly as " +
        "written (Rs. amounts, percentages, day counts, times), name the section they came from, and never supplement " +
        "them from memory. If the returned text doesn't cover the question, say so. End every such answer with one " +
        "short line noting that the Ceylon Chamber of Commerce can amend or suspend By-Laws (suspensions last up to 3 " +
        "months) so the user should verify against current CCC/CTTA notices, citing the reference's lastVerified date " +
        "when it has one.";

    // Relaxed escaping keeps "—", "≤", "Rs." readable as-is in the tool result instead of ≤
    // escapes — figures the model has to decode are figures it can garble.
    private static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string PromptFor(CttaBylawsTool? tool) => tool is null ? "" : PromptInstructions;

    public static IReadOnlyList<ToolDef> WithDefinition(CttaBylawsTool? tool, IReadOnlyList<ToolDef> definitions) =>
        tool is null || definitions.Any(d => string.Equals(d.Name, Name, StringComparison.Ordinal)) ? definitions : [.. definitions, Definition];

    public static Func<string, string, Task<string>> Dispatch(CttaBylawsTool? tool, Func<string, string, Task<string>> inner) =>
        tool is null ? inner : (name, args) => string.Equals(name, Name, StringComparison.Ordinal) ? Task.FromResult(tool.Execute(args)) : inner(name, args);

    public string Execute(string? argumentsJson)
    {
        logger.LogInformation("By-laws tool call: args={Args}", argumentsJson);
        try
        {
            var topic = AssistantToolExecutor.ParseArgs(argumentsJson)["topic"]?.ToString();
            var result = bylaws.Lookup(topic);
            if (result is null)
            {
                return JsonSerializer.Serialize(new
                {
                    error = "The CTTA By-Laws reference isn't available on this server. Tell the user it can't be " +
                            "looked up right now — do not answer from memory.",
                }, Json);
            }

            return JsonSerializer.Serialize(new
            {
                source = "By-Laws and Conditions for the Sale of Tea by Public Auction and by Private Treaty, adopted " +
                         "by the Ceylon Chamber of Commerce on 30 June 2023 (the original PDF remains legally authoritative).",
                lastVerified = result.LastVerified,
                caveat = result.Caveat,
                matchedSections = result.MatchedSections,
                sections = result.Sections.Select(s => new { title = s.Title, text = s.Text }),
                availableSections = result.AvailableSections,
                note = result.MatchedSections.Count == 0
                    ? "No section matched that topic — only the key constants are included. If they don't answer the " +
                      "question, call again with one of availableSections as the topic."
                    : null,
            }, Json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "By-laws tool call failed: args={Args}", argumentsJson);
            return JsonSerializer.Serialize(new { error = $"Tool '{Name}' failed: {ex.Message}" }, Json);
        }
    }
}
