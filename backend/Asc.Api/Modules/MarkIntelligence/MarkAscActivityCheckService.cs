using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

public record MarkAscActivityRunResult(
    int MarksEvaluated, int NowAtRisk, int NowLost, int Recovered, int NewlyIncoming, int NewlyShared,
    int UnresolvedMarksSeen, DateTime RunAt);

/// <summary>
/// Reconciles ASC's own weekly sale files (/data/sales, via ICatalogueSource — authoritative
/// for the 2 most-recent sales) against the already-mined archive (MarkBrokerPeriodFact —
/// authoritative for everything older) to answer, per mark: "has ASC (broker AS) sold this
/// within 3/6 months?" Deliberately reuses MarkBrokerPeriodFact rather than re-deriving
/// anything from raw auctionLots — see MarkIntelligenceMiningService, which already mines
/// that collection.
///
/// Status is a pure, deterministic function of (reconciled last-ASC-activity date, now) —
/// Active within WarningWindow, AtRisk within LostWindow, Lost beyond it — evaluated against
/// both thresholds every time, never against just one job's own window. That's deliberate:
/// an earlier version let each job resolve independently against only its own threshold, which
/// meant the 6-month job's wider "still within my window" check silently overwrote the
/// 3-month job's stricter AtRisk verdict on every run for any mark 90-180 days stale — the
/// early-warning state was live for about the hour between the two jobs and invisible the
/// rest of the week. Both scheduled jobs now call the exact same evaluation; keeping them as
/// two separate IScheduledReportJob registrations (see MarkAscActivityCheckJob /
/// Program.cs) still satisfies the spec's two named triggers and gives independent
/// schedule/enable-disable/run-history in the Admin Panel, plus redundancy if one is
/// disabled or fails — it's no longer what makes the severity distinction.
///
/// Every run is a full stateless recompute per mark (no incremental patching), matching
/// MarkIntelligenceMiningService's own re-run philosophy — safe to re-run any time. The one
/// piece of state carried forward is the mark's previous LastAscActivityAt, used only as a
/// floor (never regressed) for marks whose evidence has temporarily aged out of the
/// /data/sales window before the archive (manually re-mined, not on this schedule) has
/// caught up to it — see EvaluateAscActivity's own doc comment.
/// </summary>
public class MarkAscActivityCheckService(MongoContext db, ICatalogueSource catalogues, ILogger<MarkAscActivityCheckService> logger)
{
    private const string AscBrokerCode = "AS";

    // WarningWindow's 90 days is duplicated as a raw literal in frontend/src/app/(app)/
    // mark-intelligence/page.tsx's isRecentlyIncoming (no API exposes this constant today) —
    // change both together if this is ever retuned.
    public static readonly TimeSpan WarningWindow = TimeSpan.FromDays(90);
    public static readonly TimeSpan LostWindow = TimeSpan.FromDays(180);

    public async Task<MarkAscActivityRunResult> RunAsync(string triggerKey, CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        // TODO(remote-api-migration): replace ICatalogueSource/SaleFileStore calls with remote API client once backend migration lands.
        var allCatalogues = catalogues.ListCatalogues(); // newest first

        // ---- Single pass over every known catalogue: builds the (year,saleNo)->date map for
        // ALL of them, and — for just the 2 most-recent — the sale-file ASC facts + the
        // precedence cutoff, reusing the same GetLots() call for both rather than fetching
        // each of the 2 recent catalogues' lots twice. ----
        var periodToDateMap = new Dictionary<(int Year, int SaleNo), DateTime>();
        (int Year, int SaleNo)? cutoffPeriod = null;
        var saleFileFactsByMarkCode = new Dictionary<string, List<(int Year, int SaleNo)>>(StringComparer.OrdinalIgnoreCase);

        var validRecentCount = 0; // counts catalogues with a parseable period, not raw loop position —
                                   // a newest-first catalogue with no parseable lot (mid-import, malformed)
                                   // must not shrink the "2 most recent" window to whatever's left at a fixed index
        foreach (var cat in allCatalogues)
        {
            // TODO(remote-api-migration): replace ICatalogueSource/SaleFileStore calls with remote API client once backend migration lands.
            var lots = catalogues.GetLots(cat.Id) ?? [];
            var periodLot = lots.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l.SaleNo) && !string.IsNullOrWhiteSpace(l.SaleYear));
            if (periodLot is null || !int.TryParse(periodLot.SaleYear, out var y) || !int.TryParse(periodLot.SaleNo, out var s)) continue;
            var period = (y, s);
            periodToDateMap.TryAdd(period, cat.ImportedAt);

            if (validRecentCount >= 2) continue; // only the 2 most-recent (parseable) catalogues feed sale-file facts/cutoff
            validRecentCount++;

            if (cutoffPeriod is null || Ordinal(period) < Ordinal(cutoffPeriod.Value)) cutoffPeriod = period;
            foreach (var lot in lots)
            {
                if (string.IsNullOrWhiteSpace(lot.SellingMark)) continue;
                // /data/sales is ASC's own file store — a blank Broker column is treated as
                // ASC's own row; an explicit non-"AS" broker is skipped (defensive, in case a
                // file ever carries mixed-broker rows).
                if (!string.IsNullOrWhiteSpace(lot.Broker) && !string.Equals(lot.Broker, AscBrokerCode, StringComparison.OrdinalIgnoreCase)) continue;
                var markCode = lot.SellingMark.Trim().ToUpperInvariant();
                (saleFileFactsByMarkCode.TryGetValue(markCode, out var list) ? list : saleFileFactsByMarkCode[markCode] = []).Add(period);
            }
        }

        // A period with no /data/sales catalogue (very old archive years, or a brand-new
        // archive period /data/sales hasn't caught up to) falls back to just outside
        // LostWindow — conservative: never counts an unresolvable-date archive period as
        // recent evidence of activity, and stays correct however LostWindow is tuned later.
        DateTime PeriodToDate(int year, int saleNo) =>
            periodToDateMap.TryGetValue((year, saleNo), out var d) ? d : now - LostWindow - TimeSpan.FromDays(1);

        // ---- Archive-side ASC facts, already mined into MarkBrokerPeriodFact ----
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var archiveRows = await db.MarkBrokerPeriodFacts
            .Find(f => f.BrokerCode == AscBrokerCode)
            .Project(f => new { f.MarkId, f.SaleYear, f.SaleNo })
            .ToListAsync(ct);
        var archiveFactsByMark = archiveRows
            .GroupBy(f => f.MarkId)
            .ToDictionary(g => g.Key, g => g.Select(f => (f.SaleYear, f.SaleNo)).Distinct().ToList());

        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var allMarks = await db.Marks.Find(FilterDefinition<Mark>.Empty).ToListAsync(ct);
        var existingMarkCodes = new HashSet<string>(allMarks.Select(m => m.Code), StringComparer.OrdinalIgnoreCase);

        // ---- Unresolved marks: a SellingMark in /data/sales with no matching Mark anywhere —
        // see UnresolvedMarkSighting's own doc comment for why this is surfaced, not fabricated. ----
        var unresolvedCodes = DetectUnresolvedMarkCodes(saleFileFactsByMarkCode.Keys, existingMarkCodes);
        foreach (var code in unresolvedCodes)
        {
            var latestPeriod = saleFileFactsByMarkCode[code].OrderByDescending(Ordinal).First();
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.UnresolvedMarkSightings.UpdateOneAsync(
                Builders<UnresolvedMarkSighting>.Filter.Eq(s => s.MarkCode, code),
                Builders<UnresolvedMarkSighting>.Update
                    .Set(s => s.LastSeenAt, now)
                    .Set(s => s.SaleYear, latestPeriod.Year)
                    .Set(s => s.SaleNo, latestPeriod.SaleNo)
                    .Set(s => s.Resolved, false)
                    .Unset(s => s.ResolvedAt)
                    .SetOnInsert(s => s.FirstSeenAt, now)
                    .Inc(s => s.SightingCount, 1),
                new UpdateOptions { IsUpsert = true },
                ct);
        }
        // A previously-unresolved sighting whose code now has a real Mark (the archive got
        // mined, or an admin added it by hand) gets marked Resolved — no separate cleanup job.
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var stillUnresolved = await db.UnresolvedMarkSightings.Find(s => !s.Resolved).ToListAsync(ct);
        var newlyResolvedIds = stillUnresolved.Where(s => existingMarkCodes.Contains(s.MarkCode)).Select(s => s.MarkCode).ToList();
        if (newlyResolvedIds.Count > 0)
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.UnresolvedMarkSightings.UpdateManyAsync(
                Builders<UnresolvedMarkSighting>.Filter.In(s => s.MarkCode, newlyResolvedIds),
                Builders<UnresolvedMarkSighting>.Update.Set(s => s.Resolved, true).Set(s => s.ResolvedAt, now),
                cancellationToken: ct);

        int nowAtRisk = 0, nowLost = 0, recovered = 0, newlyIncoming = 0, newlyShared = 0, evaluated = 0;
        var snapshots = new List<MarkActivitySnapshot>();

        foreach (var mark in allMarks)
        {
            var saleFileFacts = saleFileFactsByMarkCode.GetValueOrDefault(mark.Code, []);
            var archFacts = archiveFactsByMark.GetValueOrDefault(mark.Id, []);

            // A mark with no ASC fact anywhere (the vast majority of the multi-broker
            // archive) has never been "ours" — out of scope for this check entirely, so it
            // never gets spuriously stamped AtRisk/Lost just for lacking history it was
            // never going to have.
            if (saleFileFacts.Count == 0 && archFacts.Count == 0 && mark.LastAscActivityAt is null) continue;
            evaluated++;

            var previousStatus = mark.AscActivityStatus;
            var (status, lastActivity) = EvaluateAscActivity(
                saleFileFacts, archFacts, cutoffPeriod, mark.LastAscActivityAt, WarningWindow, LostWindow, PeriodToDate, now);

            var statusChanged = status != previousStatus;
            if (status == AscActivityStatus.AtRisk) nowAtRisk++;
            if (status == AscActivityStatus.Lost) nowLost++;
            if (statusChanged && status == AscActivityStatus.Active) recovered++;

            var isCurrentlyOurs = status != AscActivityStatus.Lost;
            var (effectiveList, newlySharedThisRun) = EvaluateBrokerSetChange(mark.CurrentBrokers, isCurrentlyOurs, mark.LastKnownBrokerSet);
            if (newlySharedThisRun) newlyShared++;

            var firstSeen = mark.FirstSeenWithAsc;
            var newlyIncomingThisRun = false;
            if (firstSeen is null && status == AscActivityStatus.Active)
            {
                firstSeen = lastActivity ?? now;
                newlyIncomingThisRun = true;
                newlyIncoming++;
            }

            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.Marks.UpdateOneAsync(
                Builders<Mark>.Filter.Eq(m => m.Id, mark.Id),
                Builders<Mark>.Update
                    .Set(m => m.AscActivityStatus, status)
                    .Set(m => m.LastAscActivityAt, lastActivity)
                    .Set(m => m.AscActivityCheckedAt, now)
                    .Set(m => m.LastKnownBrokerSet, effectiveList)
                    .Set(m => m.FirstSeenWithAsc, firstSeen)
                    .Set(m => m.UpdatedAt, now),
                cancellationToken: ct);

            snapshots.Add(new MarkActivitySnapshot
            {
                MarkId = mark.Id,
                TriggerKey = triggerKey,
                RunAt = now,
                Status = status,
                IsCurrentlyOurs = isCurrentlyOurs,
                LastAscActivityAt = lastActivity,
                StatusChanged = statusChanged,
                BrokerSetAtRun = effectiveList,
                NewlySharedDetected = newlySharedThisRun,
                NewlyIncomingForAsc = newlyIncomingThisRun,
            });
        }

        if (snapshots.Count > 0)
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            await db.MarkActivitySnapshots.InsertManyAsync(snapshots, cancellationToken: ct);

        var result = new MarkAscActivityRunResult(
            evaluated, nowAtRisk, nowLost, recovered, newlyIncoming, newlyShared, unresolvedCodes.Count, now);
        logger.LogInformation(
            "Mark ASC-activity check [{Trigger}]: {Evaluated} marks evaluated, {AtRisk} at risk, {Lost} lost, " +
            "{Recovered} recovered, {NewlyIncoming} newly incoming, {NewlyShared} newly shared, {Unresolved} unresolved marks seen.",
            triggerKey, result.MarksEvaluated, result.NowAtRisk, result.NowLost, result.Recovered, result.NewlyIncoming,
            result.NewlyShared, result.UnresolvedMarksSeen);
        return result;
    }

    private static int Ordinal((int Year, int SaleNo) p) => p.Year * 100 + p.SaleNo;

    /// <summary>Pure set difference — no I/O. Every SellingMark code seen in this run's
    /// sale-file facts that has no matching existing Mark.Code, case-insensitively.</summary>
    public static List<string> DetectUnresolvedMarkCodes(IEnumerable<string> saleFileMarkCodes, IReadOnlySet<string> existingMarkCodes) =>
        saleFileMarkCodes.Where(code => !existingMarkCodes.Contains(code)).ToList();

    /// <summary>
    /// Pure broker-set-change comparison — no I/O. Folds "AS" in/out of currentBrokers per
    /// this run's own ASC-activity finding (so a mark /data/sales just revealed as ASC's
    /// isn't missed while the manual mining job's CurrentBrokers hasn't caught up yet), then
    /// compares the result against previousKnownBrokerSet (the baseline from the last run of
    /// either job). A broker gained in either direction — on a mark that's actually shared as
    /// a result — flags "newly shared." The very first run for a mark (empty previous set) is
    /// never itself flagged, since there's no real baseline yet to have changed from.
    /// </summary>
    public static (List<string> EffectiveBrokers, bool NewlyShared) EvaluateBrokerSetChange(
        IReadOnlyList<string> currentBrokers, bool isCurrentlyOurs, IReadOnlyList<string> previousKnownBrokerSet)
    {
        var effective = new HashSet<string>(currentBrokers, StringComparer.OrdinalIgnoreCase);
        if (isCurrentlyOurs) effective.Add(AscBrokerCode); else effective.Remove(AscBrokerCode);
        var effectiveList = effective.OrderBy(b => b, StringComparer.OrdinalIgnoreCase).ToList();

        var previousSet = new HashSet<string>(previousKnownBrokerSet, StringComparer.OrdinalIgnoreCase);
        var gainedABroker = effective.Any(b => !previousSet.Contains(b));
        var newlyShared = previousKnownBrokerSet.Count > 0 && gainedABroker && effectiveList.Count > 1;
        return (effectiveList, newlyShared);
    }

    /// <summary>
    /// Pure reconciliation + evaluation core — no I/O, fully unit-testable. Merges the two
    /// sources per the precedence rule (sale-file facts win outright for their own periods;
    /// archive facts count only strictly before recentCutoffPeriod), then classifies the most
    /// recent resulting fact against BOTH thresholds together — Active within warningWindow,
    /// AtRisk within lostWindow, Lost beyond it — rather than one job resolving only against
    /// its own single window (see the class doc comment for why that was wrong).
    ///
    /// When this run finds no fresh evidence at all, previousLastAscActivityAt is used as a
    /// floor rather than discarding it: /data/sales is only authoritative for the 2 most-recent
    /// sales, and the archive only reflects whatever the last *manual* mining run mined — so a
    /// real ASC sale from 3+ sales ago can briefly have no representation in either source
    /// until the next mining run catches up. Falling back to the previous date (rather than
    /// null) stops that mining-cadence gap from being misread as the mark going stale; the
    /// status is still recomputed fresh from whichever date (new or carried-forward) applies.
    /// </summary>
    public static (AscActivityStatus Status, DateTime? LastAscActivityAt) EvaluateAscActivity(
        IReadOnlyList<(int Year, int SaleNo)> saleFileAscFacts,
        IReadOnlyList<(int Year, int SaleNo)> archiveAscFacts,
        (int Year, int SaleNo)? recentCutoffPeriod,
        DateTime? previousLastAscActivityAt,
        TimeSpan warningWindow,
        TimeSpan lostWindow,
        Func<int, int, DateTime> periodToDate,
        DateTime now)
    {
        var merged = new List<(int Year, int SaleNo)>(saleFileAscFacts);
        merged.AddRange(recentCutoffPeriod is { } cutoff
            ? archiveAscFacts.Where(f => Ordinal(f) < Ordinal(cutoff))
            : archiveAscFacts);

        DateTime? freshDate = null;
        if (merged.Count > 0)
        {
            var latest = merged.OrderByDescending(Ordinal).First();
            freshDate = periodToDate(latest.Year, latest.SaleNo);
        }
        DateTime? lastActivityAt = freshDate is null ? previousLastAscActivityAt
            : previousLastAscActivityAt is { } prev && prev > freshDate ? prev
            : freshDate;

        if (lastActivityAt is null) return (AscActivityStatus.Lost, null);

        var age = now - lastActivityAt.Value;
        var status = age <= warningWindow ? AscActivityStatus.Active
            : age <= lostWindow ? AscActivityStatus.AtRisk
            : AscActivityStatus.Lost;
        return (status, lastActivityAt);
    }
}
