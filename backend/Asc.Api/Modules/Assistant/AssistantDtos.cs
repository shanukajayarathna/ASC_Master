namespace Asc.Api.Modules.Assistant;

/// <summary>Agent is optional and unused by any client today — omitting it (the existing
/// contract) resolves through AgentRouter's default, currently always GeneralAgent. Wired
/// through now so a future client can pass e.g. "auction" once a second agent exists, without
/// another DTO/controller change.</summary>
/// <summary>CatalogueId is the sale currently selected in the app's Topbar, so agents can
/// ground "the current sale" without a tool round-trip (see AgentContext.ActiveSaleLine).
/// Optional — older clients that never send it lose nothing but that grounding.</summary>
public record ChatRequestDto(Guid? ConversationId, string Message, string? Provider = null, string? Agent = null, Guid? CatalogueId = null);

public record ChatResponseDto(Guid ConversationId, string Reply, string Provider);

public record ConversationDto(Guid Id, string Title, DateTime CreatedAt);

public record MessageDto(Guid Id, string Role, string Content, DateTime CreatedAt, string? Provider);

public record CompareRequestDto(string Message, List<string>? Providers = null);

public record CompareResultDto(string Provider, bool Success, string? Reply, long DurationMs, string? Error);
