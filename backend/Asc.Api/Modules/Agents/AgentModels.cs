namespace Asc.Api.Modules.Agents;

/// <summary>History already includes the current turn (the caller appends it before calling,
/// same as AssistantController always has) — Message is a convenience for an agent/router
/// that wants the latest turn without re-deriving it from History.</summary>
public record AgentRequest(string Message, IReadOnlyList<(string Role, string Content)> History, string? ProviderKey, bool IsAdmin);

public record AgentResponse(string Reply, string ProviderKey);

/// <summary>
/// User Request → Agent Router → Selected Agent → Knowledge Service → LLM → Agent Response.
/// Exactly one implementation exists today (GeneralAgent); a second (e.g. a narrower
/// Auction-specific agent) is additive — implement this, register it, AgentRouter and every
/// caller pick it up with no other change.
/// </summary>
public interface IAgent
{
    string Key { get; }
    string Name { get; }

    Task<AgentResponse> HandleAsync(AgentRequest request, CancellationToken ct = default);
}
