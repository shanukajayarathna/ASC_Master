namespace Asc.Api.Modules.Assistant;

/// <summary>Agent is optional and unused by any client today — omitting it (the existing
/// contract) resolves through AgentRouter's default, currently always GeneralAgent. Wired
/// through now so a future client can pass e.g. "auction" once a second agent exists, without
/// another DTO/controller change.</summary>
/// <summary>CatalogueId is the sale currently selected in the app's Topbar, so agents can
/// ground "the current sale" without a tool round-trip (see AgentContext.ActiveSaleLine).
/// Optional — older clients that never send it lose nothing but that grounding.</summary>
/// <summary>Agent "auto" lets the assistant choose (see IntentRouter); PreviousAgent is the agent that answered the last turn, so short follow-ups stay with it.</summary>
public record ChatRequestDto(Guid? ConversationId, string Message, string? Provider = null, string? Agent = null, Guid? CatalogueId = null, string? PreviousAgent = null, ChatScopeDto? Scope = null);

/// <summary>The stretch of the archive the user chose (one sale, a range, or whole years). Omitted = not restricted.</summary>
public record ChatScopeDto(int FromYear, int? FromSale, int ToYear, int? ToSale)
{
    public Asc.Api.Modules.Agents.ArchiveScope ToScope() => new(FromYear, FromSale, ToYear, ToSale);
}

/// <summary>Sources is additive: where the answer's figures came from (empty when no tool was used).</summary>
public record ChatResponseDto(Guid ConversationId, string Reply, string Provider, IReadOnlyList<Asc.Api.Modules.Agents.ChatSource>? Sources = null, string? Agent = null);

public record ConversationDto(Guid Id, string Title, DateTime CreatedAt);

public record MessageDto(Guid Id, string Role, string Content, DateTime CreatedAt, string? Provider);

public record CompareRequestDto(string Message, List<string>? Providers = null);

public record CompareResultDto(string Provider, bool Success, string? Reply, long DurationMs, string? Error);
