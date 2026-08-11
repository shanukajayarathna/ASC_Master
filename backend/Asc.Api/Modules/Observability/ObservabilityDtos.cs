namespace Asc.Api.Modules.Observability;

public record AiUsageSummaryRowDto(
    string ProviderKey, string Model, long CallCount, long FailureCount,
    long PromptTokens, long CompletionTokens, decimal? EstimatedCostUsd);
