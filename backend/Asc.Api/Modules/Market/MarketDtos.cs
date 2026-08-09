namespace Asc.Api.Modules.Market;

public record ImportActualsResultDto(string FileName, int Matched, int Unmatched, int Ambiguous, DateTime ImportedAt);

/// <summary>FileEmbeddedMatched is independent of HasImport/Matched — it's the count of lots
/// whose Status/PurchasedPrice already reflect a settled sale straight from the sale file
/// itself, with no manual "Import Actual Results" upload involved.</summary>
public record ImportStatusDto(bool HasImport, DateTime? LastImportedAt, int Matched, int Unmatched, int Ambiguous, int FileEmbeddedMatched);

public record AccuracyOverviewDto(
    int LotsCompared,
    decimal? Accuracy,
    decimal? Mape,
    decimal? Rmse,
    decimal? AvgError,
    decimal? TotalGain,
    decimal? TotalLoss
);

public record AccuracyBucketDto(string Label, int Count, decimal Mape, decimal Bias);

/// <summary>Structured, not the original's HTML-with-&lt;strong&gt;-tags string — the frontend
/// composes the sentence in JSX so a broker/grade name can never inject markup.</summary>
public record MarketInsightDto(string Dimension, string Key, int Count, decimal AvgDiff, string Direction, decimal Magnitude);
