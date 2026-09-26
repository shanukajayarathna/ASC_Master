namespace Asc.Api.Modules.Oklo;

/// <summary>Keeps the live view warm: the sale directory fresh, the newest live/recent sales loaded
/// and current (so opening one is instant), and lot counts known for the sale list.</summary>
public class OkloLiveWarmService(OkloLiveSales live, OkloSyncService sync, ILogger<OkloLiveWarmService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!live.Enabled)
        {
            log.LogInformation("OKLO live view is off (LiveView or credentials missing)");
            return;
        }
        log.LogInformation("OKLO live view started");
        // Valuations saved against the old (content-hash) lot ids are re-linked to the stable ids in the background,
        // as soon as the sales they belong to can be loaded. Retried every 10 minutes (OKLO can be slow or briefly
        // down) until nothing is pending, then the loop just idles.
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20), ct);
                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        var n = await sync.MigratePendingAsync(ct);
                        if (n > 0) log.LogInformation("OKLO re-link finished for {Count} sale(s)", n);
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception ex) { log.LogWarning("OKLO re-link failed: {Message}", ex.Message); }
                    await Task.Delay(TimeSpan.FromMinutes(10), ct);
                }
            }
            catch (OperationCanceledException) { /* shutting down */ }
        }, ct);
        while (!ct.IsCancellationRequested)
        {
            var wait = TimeSpan.FromSeconds(30);
            try { wait = await live.WarmStepAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogWarning("OKLO live warm step failed: {Message}", ex.Message); }
            try { await Task.Delay(wait, ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
