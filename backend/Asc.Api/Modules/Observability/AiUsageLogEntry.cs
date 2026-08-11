using MongoDB.Bson;

namespace Asc.Api.Modules.Observability;

/// <summary>One row per completed (or failed) AI Gateway call — see AiUsageLogger. The raw
/// token counts are the source of truth; EstimatedCostUsd is derived from Modules/Observability's
/// configurable price table and is null whenever that table has no entry for the model, rather
/// than guessing a rate.</summary>
public class AiUsageLogEntry
{
    public ObjectId Id { get; set; }
    public string ProviderKey { get; set; } = "";
    public string Model { get; set; } = "";
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int TotalTokens { get; set; }
    public decimal? EstimatedCostUsd { get; set; }
    public bool Success { get; set; }
    public long DurationMs { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
