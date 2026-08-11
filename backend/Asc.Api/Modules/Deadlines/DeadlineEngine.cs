using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Notifications;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Deadlines;

/// <summary>
/// The only deadline type that exists today is a catalogue's own closure — its auction date
/// is already real data (Catalogue.ImportedAt *is* the auction date; see SaleFileStore's
/// SaleDateFor), so there is nothing to author here, only to derive and track. Escalation
/// thresholds are named real-unit constants, same style as MarketController.ComputeInsights,
/// not an invented statistical model.
/// </summary>
public class DeadlineEngine(ICatalogueSource source, MongoContext db, INotificationService notifications)
{
    public const string CatalogueClosureType = "catalogue.closure";

    // Sentinel level, always more urgent than any ladder rung — a passed deadline with lots
    // still pending is worse than "4 hours left," not a fourth rung on the same ladder.
    internal const int MissedLevel = 100;

    // Mirrors the roadmap's own "2 hours remaining... required: valuation completion"
    // example almost exactly.
    internal static readonly (int Level, TimeSpan LeadTime, string Priority)[] EscalationLadder =
    [
        (1, TimeSpan.FromHours(48), "normal"),
        (2, TimeSpan.FromHours(24), "normal"),
        (3, TimeSpan.FromHours(4), "high"),
    ];

    // How far into the future/past a catalogue's auction date has to be before this bothers
    // computing its pending-valuation count at all — keeps every tick cheap regardless of
    // how many sales exist in total (33 today, more later).
    private static readonly TimeSpan LookaheadForReminders = TimeSpan.FromHours(48);
    private static readonly TimeSpan LookbackForMissed = TimeSpan.FromHours(24);

    public async Task CheckCatalogueClosureDeadlines(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var candidates = source.ListCatalogues()
            .Where(c => c.ImportedAt >= now - LookbackForMissed && c.ImportedAt <= now + LookaheadForReminders)
            .ToList();

        foreach (var catalogue in candidates)
        {
            var lots = source.GetLots(catalogue.Id);
            if (lots is null || lots.Count == 0) continue;

            var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogue.Id).ToListAsync(ct))
                .ToDictionary(v => v.LotId, v => v.Valuation);
            var merged = lots.Select(l => (Lot: l, Val: LotsController.Merged(l, overrides))).ToList();
            var pending = DashboardController.Compute(merged).Pending;
            if (pending == 0) continue;

            var tracking = await db.Deadlines
                .Find(d => d.Type == CatalogueClosureType && d.EntityId == catalogue.Id)
                .FirstOrDefaultAsync(ct)
                ?? new Deadline { Type = CatalogueClosureType, EntityId = catalogue.Id, ResponsibleRole = RoleNames.Valuer };

            var remaining = catalogue.ImportedAt - now;
            if (DetermineLevel(remaining, tracking.NotifiedEscalationLevel) is not { } determined) continue;

            var (title, body) = BuildMessage(catalogue.SourceName, determined.Level, pending, remaining);
            await notifications.NotifyUsersInRoleAsync(
                RoleNames.Valuer, CatalogueClosureType, title, body, "/valuation", determined.Priority, "Catalogue", catalogue.Id.ToString(), ct);
            await notifications.NotifyUsersInRoleAsync(
                RoleNames.Admin, CatalogueClosureType, title, body, "/valuation", determined.Priority, "Catalogue", catalogue.Id.ToString(), ct);

            tracking.EntityLabel = catalogue.SourceName;
            tracking.DueAt = catalogue.ImportedAt;
            tracking.NotifiedEscalationLevel = determined.Level;
            tracking.Status = determined.Level == MissedLevel ? DeadlineStatus.Missed
                : determined.Level == EscalationLadder[^1].Level ? DeadlineStatus.Escalated
                : DeadlineStatus.Reminded;
            tracking.UpdatedAt = now;

            await db.Deadlines.ReplaceOneAsync(d => d.Id == tracking.Id, tracking, new ReplaceOptions { IsUpsert = true }, ct);
        }
    }

    public Task<List<Deadline>> GetUpcoming(CancellationToken ct = default) =>
        db.Deadlines.Find(d => d.Status != DeadlineStatus.Completed)
            .SortBy(d => d.DueAt)
            .Limit(20)
            .ToListAsync(ct);

    /// <summary>Pure — no Mongo/ICatalogueSource — so it's directly unit-testable. Returns
    /// the most urgent ladder rung `remaining` has crossed, or null if nothing new applies
    /// (still further out than the first rung, or already notified at this level or a more
    /// urgent one).</summary>
    internal static (int Level, string Priority)? DetermineLevel(TimeSpan remaining, int alreadyNotifiedLevel)
    {
        if (remaining < TimeSpan.Zero)
            return alreadyNotifiedLevel < MissedLevel ? (MissedLevel, "high") : null;

        var crossed = EscalationLadder.Where(l => remaining <= l.LeadTime).OrderByDescending(l => l.Level).FirstOrDefault();
        if (crossed.Level == 0) return null;
        if (crossed.Level <= alreadyNotifiedLevel) return null;

        return (crossed.Level, crossed.Priority);
    }

    private static (string Title, string Body) BuildMessage(string catalogueName, int level, int pending, TimeSpan remaining)
    {
        var lotsPhrase = $"{pending} lot{(pending == 1 ? "" : "s")} still need valuation";

        if (level == MissedLevel)
            return ($"{catalogueName} closure deadline passed", $"{lotsPhrase} and the auction date has already passed.");

        var hours = Math.Max(0, (int)Math.Round(remaining.TotalHours));
        var urgency = level switch { 1 => "approaching", 2 => "approaching soon", _ => "imminent" };
        return ($"{catalogueName} closure {urgency}", $"{lotsPhrase} — about {hours} hour{(hours == 1 ? "" : "s")} remaining.");
    }
}
