using Asc.Api.Services;

namespace Asc.Api.Modules.Agents;

/// <summary>History already includes the current turn (the caller appends it before calling,
/// same as AssistantController always has) — Message is a convenience for an agent/router
/// that wants the latest turn without re-deriving it from History. ActiveCatalogueId is the
/// sale currently selected in the app's Topbar (null for clients that don't send one) — see
/// AgentContext.ActiveSaleLine for how agents ground "the current sale" with it.</summary>
public record AgentRequest(string Message, IReadOnlyList<(string Role, string Content)> History, string? ProviderKey, bool IsAdmin, Guid? ActiveCatalogueId = null);

/// <summary>
/// Shared request-context lines agents append to their system prompts.
/// </summary>
public static class AgentContext
{
    /// <summary>
    /// Grounds "the current sale" deterministically: the client already knows which sale is
    /// selected in the Topbar, so telling the model outright removes the list_catalogues
    /// round-trip every provider previously needed to resolve "current" — and small local
    /// models often failed that hop entirely, asking the user for a catalogue id instead.
    /// Null when no catalogue is selected, the id no longer matches a sale on disk, or the
    /// client didn't send one — the prompt then simply keeps its original behavior.
    /// </summary>
    public static string? ActiveSaleLine(ICatalogueSource? catalogues, Guid? activeCatalogueId)
    {
        if (catalogues is null || activeCatalogueId is not { } id) return null;
        var list = catalogues.ListCatalogues();
        var index = -1;
        for (var i = 0; i < list.Count; i++)
            if (list[i].Id == id) { index = i; break; }
        if (index < 0) return null;

        var line =
            " The sale currently selected in the app is \"" + list[index].SourceName + "\", catalogue id " + id + ". " +
            "When the user says 'the current sale', 'this sale', 'this week', or asks a sale-scoped " +
            "question without naming a sale, use this catalogue id directly with catalogue-scoped " +
            "tools — do not ask the user for a catalogue id and do not call list_catalogues just to " +
            "find the current sale.";

        // The list is newest-first, so the previous sale is simply the next entry. Naming it
        // here too grounds the other high-frequency reference ("the previous sale" / "last
        // week" / "the last two sales") the same way — without it, models must realize
        // list_catalogues resolves that phrase, a hop observed to defeat small local models
        // (one invented a literal "previous_sale_id" argument instead).
        if (index + 1 < list.Count)
        {
            var prev = list[index + 1];
            line += " The previous sale is \"" + prev.SourceName + "\", catalogue id " + prev.Id + " — for " +
                    "'previous sale' / 'last week' questions or current-vs-previous comparisons, use these " +
                    "two real ids directly (e.g. compare_sales with both).";
        }

        line += " Only when the user names some other sale, find that sale's id via list_catalogues.";
        return line;
    }
}

public record AgentResponse(string Reply, string ProviderKey);

/// <summary>
/// User Request → AgentRouter → IAgentRegistry → Selected Agent → Knowledge Service → LLM →
/// Agent Response (see Modules/Agents/README.md). Exactly one implementation exists today
/// (GeneralAgent); a second (e.g. a narrower Auction-specific agent) is additive — implement
/// this, register it in Program.cs, AgentRegistry/AgentRouter and every caller pick it up with
/// no other change. Deliberately provider-agnostic: no HTTP, n8n, WhatsApp, or Temporal
/// concept belongs here — this interface is the seam between routing and one agent's own
/// internal tool/LLM wiring, nothing more.
/// </summary>
public interface IAgent
{
    string Key { get; }
    string Name { get; }

    /// <summary>One sentence a router, an admin UI, or a future LLM-based classifier could show
    /// a caller to decide whether this agent is the right one — not used for routing today.</summary>
    string Description { get; }

    /// <summary>Coarse capability tags (e.g. "documents", "valuations") for future routing/
    /// authorization decisions. Not a taxonomy — just enough for a router to reason about
    /// "does this agent plausibly cover that request" without parsing free text.</summary>
    IReadOnlyList<string> Capabilities { get; }

    Task<AgentResponse> HandleAsync(AgentRequest request, CancellationToken ct = default);
}
