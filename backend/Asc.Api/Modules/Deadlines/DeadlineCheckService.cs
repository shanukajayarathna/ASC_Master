namespace Asc.Api.Modules.Deadlines;

/// <summary>
/// The first *recurring* background job in this codebase — SaleMetaWarmer only ever runs
/// once at startup, so this owns its own timer loop rather than copying that shape.
/// DeadlineEngine is a singleton (same lifetime as everything else this touches:
/// MongoContext, INotificationService), so no IServiceScopeFactory dance is needed.
/// </summary>
public class DeadlineCheckService(DeadlineEngine engine, ILogger<DeadlineCheckService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(15);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await engine.CheckCatalogueClosureDeadlines(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A failed check must never take the loop down with it — the next tick
                // tries again in CheckInterval regardless of what went wrong this time.
                logger.LogError(ex, "Deadline check failed");
            }

            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
