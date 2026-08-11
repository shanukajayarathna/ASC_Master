namespace Asc.Api.Modules.Performance;

/// <summary>Description is a deterministic, server-built sentence — never AI-generated —
/// so anything that narrates this (the Performance page, the AI assistant) can only ever
/// repeat real numbers this engine actually computed.</summary>
public record PerformanceInsightDto(
    string Dimension, string Key, string Direction, double Magnitude, string Unit, int SalesSpan, string Description);
