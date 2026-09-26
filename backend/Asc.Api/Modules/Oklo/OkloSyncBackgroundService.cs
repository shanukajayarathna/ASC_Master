namespace Asc.Api.Modules.Oklo;

/// <summary>
/// Keeps data/sales current from OKLO. Runs only when Oklo:AutoSync is on and credentials are
/// present. Each pass syncs the single most urgent due sale (see OkloSyncService.NextDue); when
/// nothing is due it naps, but wakes immediately when someone uses the system — RequestRefresh
/// (called by the API) asks for every recent/live sale older than two minutes to be re-pulled.
/// </summary>
public class OkloSyncBackgroundService(OkloSyncService sync, ILogger<OkloSyncBackgroundService> log) : BackgroundService
{
    private static readonly TimeSpan OnDemandMaxAge = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(20);

    private readonly SemaphoreSlim _wake = new(0, 1);
    private long _urgentUntilTicks;

    /// <summary>Called when the system is being used: pull recent sales that are stale, now.</summary>
    public void RequestRefresh()
    {
        Interlocked.Exchange(ref _urgentUntilTicks, DateTime.UtcNow.AddMinutes(3).Ticks);
        try { _wake.Release(); } catch (SemaphoreFullException) { /* a wake is already pending */ }
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!sync.AutoSync || !sync.IsConfigured)
        {
            log.LogInformation("OKLO auto-sync is off (AutoSync={Auto}, configured={Configured})", sync.AutoSync, sync.IsConfigured);
            return;
        }
        log.LogInformation("OKLO auto-sync started");
        while (!ct.IsCancellationRequested)
        {
            TimeSpan? pause = null;
            try
            {
                var urgent = DateTime.UtcNow.Ticks < Interlocked.Read(ref _urgentUntilTicks);
                pause = await sync.StepAsync(urgent ? OnDemandMaxAge : null, recentOnly: urgent, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                log.LogWarning("OKLO sync step failed: {Message}", ex.Message);
                await DelayAsync(TimeSpan.FromMinutes(1), ct);
                continue;
            }
            // Short pause after live/recent work, a longer one after back-fill (throttle); nap when idle. Wakes early on demand.
            await DelayAsync(pause ?? IdleDelay, ct);
        }
    }

    private async Task DelayAsync(TimeSpan delay, CancellationToken ct)
    {
        try { await _wake.WaitAsync(delay, ct); }
        catch (OperationCanceledException) { /* shutting down */ }
    }
}
