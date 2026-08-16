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
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // App shutdown mid-check — not a failure.
            }
            catch (Exception ex)
            {
                // A failed check must never take the loop down with it — the next tick
                // tries again in CheckInterval regardless of what went wrong this time.
                // Must catch OperationCanceledException-derived types too (e.g. a MongoDB
                // TaskCanceledException from a timeout/transient hiccup, unrelated to
                // shutdown) — `ex is not OperationCanceledException` let those slip through
                // uncaught, and BackgroundService's default StopHost behavior turns any
                // uncaught exception here into the entire API host going down.
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
