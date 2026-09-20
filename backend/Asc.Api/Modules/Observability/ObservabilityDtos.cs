namespace Asc.Api.Modules.Observability;

public record AiUsageSummaryRowDto(
    string ProviderKey, string Model, long CallCount, long FailureCount,
    long PromptTokens, long CompletionTokens, decimal? EstimatedCostUsd);

/// <summary>Per-agent usage over a window. Agent is null for calls made outside an agent (and older rows).</summary>
public record AgentUsageRowDto(
    string? Agent, long CallCount, long FailureCount, long PromptTokens, long CompletionTokens, decimal? EstimatedCostUsd);
