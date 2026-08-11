namespace Asc.Api.Modules.Observability;

public interface IAiUsageLogger
{
    Task LogAsync(
        string providerKey, string model, int promptTokens, int completionTokens,
        bool success, long durationMs, CancellationToken ct = default);
}
