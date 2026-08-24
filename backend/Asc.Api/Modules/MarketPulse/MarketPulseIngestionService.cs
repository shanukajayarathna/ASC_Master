namespace Asc.Api.Modules.MarketPulse;

/// <summary>Scheduled loop over <see cref="MarketPulseIngestionEngine.RunOnceAsync"/> — same
/// plain Task.Delay shape as <c>DeadlineCheckService</c> (this app's established recurring-
/// job pattern), just with a configurable interval since the feature spec asked for one
/// (MarketPulse:PollIntervalMinutes, default 45 — the middle of the requested 30-60 min
/// range).
///
/// Unlike DeadlineCheckService/MslWatcherService, this one DOES need the
/// IServiceScopeFactory dance those two explicitly avoid: MarketPulseIngestionEngine is
/// scoped (it ultimately depends on AiGateway, which is scoped throughout this app), so a
/// new DI scope has to be created and disposed every tick to resolve a fresh instance of it
/// — a BackgroundService itself is the one long-lived singleton root, and can never safely
/// hold a scoped service across ticks.</summary>
public class MarketPulseIngestionService(
    IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<MarketPulseIngestionService> logger)
    : BackgroundService
{
    private TimeSpan PollInterval =>
        TimeSpan.FromMinutes(double.TryParse(config["MarketPulse:PollIntervalMinutes"], out var m) ? m : 45);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var engine = scope.ServiceProvider.GetRequiredService<MarketPulseIngestionEngine>();
                var summary = await engine.RunOnceAsync(stoppingToken);
                if (summary.NewItems > 0 || summary.SourcesFailed > 0)
                    logger.LogInformation(
                        "Market Pulse ingestion: {Sources} source(s) checked ({Failed} failed), {New} new item(s), {Scored} scored, {Unscored} still unscored",
                        summary.SourcesChecked, summary.SourcesFailed, summary.NewItems, summary.Scored, summary.StillUnscored);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // App shutdown mid-cycle — not a failure.
            }
            catch (Exception ex)
            {
                // A failed cycle must never take the loop down with it — see
                // DeadlineCheckService's identical reasoning (this is the same pattern).
                logger.LogError(ex, "Market Pulse ingestion cycle failed");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
