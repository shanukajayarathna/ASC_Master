using Asc.Api.Modules.MarkIntelligence;

namespace Asc.Api.Tests;

public class MarkAscActivityCheckServiceTests
{
    private static readonly DateTime Now = new(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan WarningWindow = TimeSpan.FromDays(90);
    private static readonly TimeSpan LostWindow = TimeSpan.FromDays(180);

    // One sale/week starting at (2026, sale 1) on 2026-01-05, matching real auction cadence
    // closely enough for these window-boundary tests.
    private static DateTime PeriodToDate(int year, int saleNo) =>
        year == 2026 ? new DateTime(2026, 1, 5).AddDays((saleNo - 1) * 7) : new DateTime(year, 1, 1);

    private static (AscActivityStatus, DateTime?) Evaluate(
        IReadOnlyList<(int, int)> saleFileFacts,
        IReadOnlyList<(int, int)> archiveFacts,
        (int, int)? cutoff,
        DateTime? previousLastActivity) =>
        MarkAscActivityCheckService.EvaluateAscActivity(
            saleFileFacts, archiveFacts, cutoff, previousLastActivity, WarningWindow, LostWindow, PeriodToDate, Now);

    [Fact]
    public void NoAscActivityInWarningWindow_ButWithinLostWindow_FlagsAtRisk()
    {
        // Last ASC sale was sale 20 (2026-05-18) — over 90 days before "now" (2026-09-01) but
        // under 180.
        var (status, lastActivity) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [(2026, 20)],
            cutoff: (2026, 34),
            previousLastActivity: null);

        Assert.Equal(AscActivityStatus.AtRisk, status);
        Assert.Equal(PeriodToDate(2026, 20), lastActivity);
    }

    [Fact]
    public void NoAscActivityBeyondLostWindow_FlagsLost()
    {
        var (status, _) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [(2026, 5)], // well over 180 days before "now"
            cutoff: (2026, 34),
            previousLastActivity: null);

        Assert.Equal(AscActivityStatus.Lost, status);
    }

    [Fact]
    public void FreshActivityWithinWarningWindow_ResolvesActive()
    {
        // A mark previously stale, but /data/sales shows ASC sold it again this week.
        var (status, lastActivity) = Evaluate(
            saleFileFacts: [(2026, 34)],
            archiveFacts: [(2026, 10)],
            cutoff: (2026, 33),
            previousLastActivity: PeriodToDate(2026, 10));

        Assert.Equal(AscActivityStatus.Active, status);
        Assert.Equal(PeriodToDate(2026, 34), lastActivity);
    }

    [Fact]
    public void ArchiveFactAtOrAfterCutoff_IsIgnored_SaleFileWinsForRecentPeriods()
    {
        // Archive has a (fabricated/stale) fact at sale 34 — the same period /data/sales
        // covers and found NO ASC activity for. Per the precedence rule, /data/sales wins
        // for the 2 most-recent periods, so this archive fact must not count.
        var (status, lastActivity) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [(2026, 34), (2026, 1)],
            cutoff: (2026, 33),
            previousLastActivity: null);

        // Only the sale-1 fact (before the cutoff) should have counted, which is well
        // outside both windows — so the mark should be Lost, not Active.
        Assert.Equal(AscActivityStatus.Lost, status);
        Assert.Equal(PeriodToDate(2026, 1), lastActivity);
    }

    [Fact]
    public void BothJobsAgree_SameStaleMark_NeitherWindowOverridesTheOther()
    {
        // Regression for the bug the review caught: a mark 100 days stale must read AtRisk
        // from BOTH the "3-month" and "6-month" evaluation — the 6-month job's wider window
        // must not resolve it back to Active just because 100 days is still <= 180 days.
        var facts = new[] { (2026, 20) }; // ~106 days before "now"

        var threeMonthView = Evaluate(saleFileFacts: [], archiveFacts: facts, cutoff: (2026, 34), previousLastActivity: null);
        var sixMonthView = Evaluate(saleFileFacts: [], archiveFacts: facts, cutoff: (2026, 34), previousLastActivity: null);

        Assert.Equal(AscActivityStatus.AtRisk, threeMonthView.Item1);
        Assert.Equal(AscActivityStatus.AtRisk, sixMonthView.Item1);
    }

    [Fact]
    public void NoFreshEvidence_FallsBackToPreviousLastActivity_InsteadOfDiscardingIt()
    {
        // Regression: a mark's only known ASC sale has aged out of the /data/sales "2 most
        // recent" window and hasn't been archive-mined yet this run (merged facts empty),
        // but a previous run already recorded a real LastAscActivityAt — that must be kept
        // (and re-classified against "now"), not silently nulled out.
        var previous = PeriodToDate(2026, 33); // recent enough to still be Active

        var (status, lastActivity) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [],
            cutoff: (2026, 34),
            previousLastActivity: previous);

        Assert.Equal(AscActivityStatus.Active, status);
        Assert.Equal(previous, lastActivity);
    }

    [Fact]
    public void NoFreshEvidenceAndNoPreviousActivity_ResolvesLostWithNullDate()
    {
        var (status, lastActivity) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [],
            cutoff: (2026, 34),
            previousLastActivity: null);

        Assert.Equal(AscActivityStatus.Lost, status);
        Assert.Null(lastActivity);
    }

    [Fact]
    public void FreshEvidenceOlderThanCarriedForwardDate_KeepsTheNewerCarriedForwardDate()
    {
        // The archive (only, no sale-file match) resolves to an old fact, but a more recent
        // date was already known from a previous run (e.g. sale-file evidence that has since
        // aged out of the 2-most-recent window) — the more recent of the two must win, not
        // whichever this run happened to recompute.
        var previous = PeriodToDate(2026, 32);

        var (status, lastActivity) = Evaluate(
            saleFileFacts: [],
            archiveFacts: [(2026, 5)],
            cutoff: (2026, 34),
            previousLastActivity: previous);

        Assert.Equal(previous, lastActivity);
        Assert.Equal(AscActivityStatus.Active, status);
    }

    [Fact]
    public void Idempotent_SameInputsTwice_ProduceIdenticalOutput()
    {
        (AscActivityStatus, DateTime?) Run() => Evaluate(
            saleFileFacts: [(2026, 34)],
            archiveFacts: [(2026, 10), (2026, 5)],
            cutoff: (2026, 33),
            previousLastActivity: null);

        Assert.Equal(Run(), Run());
    }

    // ---- broker-set-change (shared-mark) detection ----

    [Fact]
    public void AscGainsAPreviouslyOtherBrokerMark_FlagsNewlyShared()
    {
        var (effective, newlyShared) = MarkAscActivityCheckService.EvaluateBrokerSetChange(
            currentBrokers: ["BTL"], isCurrentlyOurs: true, previousKnownBrokerSet: ["BTL"]);

        Assert.True(newlyShared);
        Assert.Equal(["AS", "BTL"], effective);
    }

    [Fact]
    public void AnotherBrokerGainsAPreviouslyAscOnlyMark_FlagsNewlyShared()
    {
        var (effective, newlyShared) = MarkAscActivityCheckService.EvaluateBrokerSetChange(
            currentBrokers: ["AS", "JK"], isCurrentlyOurs: true, previousKnownBrokerSet: ["AS"]);

        Assert.True(newlyShared);
        Assert.Equal(["AS", "JK"], effective);
    }

    [Fact]
    public void UnchangedBrokerSet_ReRun_DoesNotReflagNewlyShared()
    {
        var (effective, newlyShared) = MarkAscActivityCheckService.EvaluateBrokerSetChange(
            currentBrokers: ["AS", "JK"], isCurrentlyOurs: true, previousKnownBrokerSet: ["AS", "JK"]);

        Assert.False(newlyShared);
        Assert.Equal(["AS", "JK"], effective);
    }

    [Fact]
    public void FirstRunEver_NoBaselineYet_NeverFlagsNewlyShared()
    {
        var (_, newlyShared) = MarkAscActivityCheckService.EvaluateBrokerSetChange(
            currentBrokers: ["AS", "JK"], isCurrentlyOurs: true, previousKnownBrokerSet: []);

        Assert.False(newlyShared);
    }

    // ---- unresolved-mark detection (a SellingMark with no matching existing Mark) ----

    [Fact]
    public void SellingMarkWithNoExistingMark_IsDetectedAsUnresolved()
    {
        var unresolved = MarkAscActivityCheckService.DetectUnresolvedMarkCodes(
            saleFileMarkCodes: ["GREEN RIDGE", "ROBGILL"],
            existingMarkCodes: new HashSet<string>(["ROBGILL"], StringComparer.OrdinalIgnoreCase));

        Assert.Equal(["GREEN RIDGE"], unresolved);
    }

    [Fact]
    public void SellingMarkMatchingExistingMark_IsNotFlaggedUnresolved_CaseInsensitively()
    {
        var unresolved = MarkAscActivityCheckService.DetectUnresolvedMarkCodes(
            saleFileMarkCodes: ["robgill"],
            existingMarkCodes: new HashSet<string>(["ROBGILL"], StringComparer.OrdinalIgnoreCase));

        Assert.Empty(unresolved);
    }
}
