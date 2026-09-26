using Microsoft.Extensions.Options;

namespace Asc.Api.Modules.Oklo;

/// <summary>
/// Pulls every OKLO sale once in the background and keeps its snapshot in the database, newest first, one at a time,
/// on the background lane with a pause between sales — so a restart is instant, a second server shares the data,
/// and reports can read history without OKLO. Recent sales are re-pulled when their snapshot is 6h+ old; finished
/// sales are final and are never re-pulled. Yields to any sale a person is waiting on.
/// </summary>
public class OkloBackfillService(OkloLiveSales live, IOptions<OkloOptions> options, ILogger<OkloBackfillService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var o = options.Value;
        if (!live.Enabled || !o.SnapshotBackfill)
        {
            log.LogInformation("OKLO snapshot backfill is off");
            return;
        }
        try { await Task.Delay(TimeSpan.FromSeconds(45), ct); } catch (OperationCanceledException) { return; }
        log.LogInformation("OKLO snapshot backfill started");
        while (!ct.IsCancellationRequested)
        {
            var didWork = false;
            try { didWork = await live.BackfillNextAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { log.LogWarning("OKLO backfill step failed: {Message}", ex.Message); }
            try { await Task.Delay(didWork ? TimeSpan.FromSeconds(Math.Max(1, o.BackfillPauseSeconds)) : TimeSpan.FromSeconds(60), ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
