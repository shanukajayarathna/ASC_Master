using Asc.Api.Data;

namespace Asc.Api.Modules.Observability;

/// <summary>Same shape as Modules/Audit/AuditLogger — a single awaited Mongo insert, own
/// collection, no retry/queue. AiGateway calls this once per completed (or failed) provider
/// call, so a bad model name or an unpriced model never blocks the actual chat response.</summary>
public class AiUsageLogger(MongoContext db, AiCostEstimator costEstimator) : IAiUsageLogger
{
    public async Task LogAsync(
        string providerKey, string model, int promptTokens, int completionTokens,
        bool success, long durationMs, CancellationToken ct = default)
    {
        var entry = new AiUsageLogEntry
        {
            ProviderKey = providerKey,
            Model = model,
            PromptTokens = promptTokens,
            CompletionTokens = completionTokens,
            TotalTokens = promptTokens + completionTokens,
            EstimatedCostUsd = costEstimator.EstimateCostUsd(model, promptTokens, completionTokens),
            Success = success,
            DurationMs = durationMs,
        };
        await db.AiUsageLogs.InsertOneAsync(entry, cancellationToken: ct);
    }
}
