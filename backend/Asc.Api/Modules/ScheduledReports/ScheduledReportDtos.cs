namespace Asc.Api.Modules.ScheduledReports;

public record ScheduledReportJobDto(
    string Key, string DisplayName, string TriggerType, string? CronExpression,
    bool Enabled, DateTime? LastRunAt, string LastStatus, string? LastMessage, long LastDurationMs, int ConsecutiveFailures);

public record ToggleJobRequestDto(bool Enabled);

public record RunNowResponseDto(bool Success, string Message);

public record StageCbacRequestDto(int SaleYear, int SaleNo, string TxtContent);

public record StagedCbacDto(int SaleYear, int SaleNo, DateTime StagedAt);

public record SavedReportSummaryDto(Guid Id, string Title, DateTime CreatedAt, string? Notes, bool Downloadable);
