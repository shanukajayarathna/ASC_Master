namespace Asc.Api.Modules.Observability;

/// <summary>
/// Reads a per-model USD-per-1M-tokens price table from configuration (section "AiPricing",
/// keyed by model name — see appsettings.json) rather than hardcoding published vendor rates
/// here: those rates change over time and get model names wrong easily, and this app must
/// never fabricate a number presented as real cost data. A model with no configured entry
/// simply gets no cost estimate (null), which the usage log and summary endpoint both surface
/// as "not priced" rather than a silently wrong dollar figure.
/// </summary>
public class AiCostEstimator(IConfiguration config)
{
    public decimal? EstimateCostUsd(string model, int promptTokens, int completionTokens)
    {
        var section = config.GetSection($"AiPricing:{model}");
        var promptPer1M = section["PromptPer1M"];
        var completionPer1M = section["CompletionPer1M"];
        if (promptPer1M is null || completionPer1M is null) return null;

        if (!decimal.TryParse(promptPer1M, out var promptRate) || !decimal.TryParse(completionPer1M, out var completionRate))
            return null;

        return promptTokens / 1_000_000m * promptRate + completionTokens / 1_000_000m * completionRate;
    }
}
