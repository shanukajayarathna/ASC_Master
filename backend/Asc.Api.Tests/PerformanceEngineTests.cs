using Asc.Api.Modules.Performance;

namespace Asc.Api.Tests;

public class PerformanceEngineTests
{
    // ---- DetectStreak (grade valuation trend) -----------------------------------------

    [Fact]
    public void DetectStreak_CleanUpwardStreakWithSufficientMagnitude_IsDetected()
    {
        // Most recent first: 120, 110, 100, 90 — 4 sales, each step up 10 as time passes
        // (i.e. strengthening), total swing over the streak = 120-90 = 30 >= floor.
        var series = new decimal[] { 120m, 110m, 100m, 90m };

        var result = PerformanceEngine.DetectStreak(series);

        Assert.NotNull(result);
        Assert.Equal(4, result.Value.SalesSpan);
        Assert.Equal(30m, result.Value.TotalSwing);
        Assert.Equal("up", result.Value.Direction);
    }

    [Fact]
    public void DetectStreak_DownwardStreak_IsDetectedWithNegativeSwing()
    {
        var series = new decimal[] { 90m, 100m, 110m, 120m }; // weakening as time passes toward now

        var result = PerformanceEngine.DetectStreak(series);

        Assert.NotNull(result);
        Assert.Equal(4, result.Value.SalesSpan);
        Assert.Equal(-30m, result.Value.TotalSwing);
        Assert.Equal("down", result.Value.Direction);
    }

    [Fact]
    public void DetectStreak_StreakTooShort_IsNotDetected()
    {
        // Only 2 sales moving the same direction — below the 3-sale minimum.
        var series = new decimal[] { 110m, 100m, 100m };

        Assert.Null(PerformanceEngine.DetectStreak(series));
    }

    [Fact]
    public void DetectStreak_LongEnoughButBelowMagnitudeFloor_IsNotDetected()
    {
        // 4 sales, consistently up, but total swing is only 3 — below the Rs.5/kg floor.
        var series = new decimal[] { 101m, 100.5m, 100.2m, 98m };

        Assert.Null(PerformanceEngine.DetectStreak(series));
    }

    [Fact]
    public void DetectStreak_NonMonotonicSeries_StopsAtTheBreak()
    {
        // Up, then a reversal — the streak should stop at the break (span 2), below minimum.
        var series = new decimal[] { 120m, 110m, 130m, 90m };

        Assert.Null(PerformanceEngine.DetectStreak(series));
    }

    [Fact]
    public void DetectStreak_FlatFirstStep_IsNotDetected()
    {
        var series = new decimal[] { 100m, 100m, 100m, 100m };

        Assert.Null(PerformanceEngine.DetectStreak(series));
    }

    [Fact]
    public void DetectStreak_TooFewDataPoints_IsNotDetected()
    {
        Assert.Null(PerformanceEngine.DetectStreak([100m]));
        Assert.Null(PerformanceEngine.DetectStreak([]));
    }

    // ---- DetectSwingPercent (buyer purchase trend) -------------------------------------

    [Fact]
    public void DetectSwingPercent_IncreaseAboveFloor_IsDetected()
    {
        // Most recent: 10 lots; prior average: (5+5)/2 = 5 -> +100% swing.
        var result = PerformanceEngine.DetectSwingPercent(10, [5, 5]);

        Assert.NotNull(result);
        Assert.Equal("increased", result.Value.Direction);
        Assert.True(result.Value.SwingPercent > 0);
    }

    [Fact]
    public void DetectSwingPercent_DecreaseAboveFloor_IsDetected()
    {
        // Most recent: 5 lots (still meets the min-lots floor); prior average: 10 -> -50%.
        var result = PerformanceEngine.DetectSwingPercent(5, [10, 10]);

        Assert.NotNull(result);
        Assert.Equal("decreased", result.Value.Direction);
        Assert.True(result.Value.SwingPercent < 0);
    }

    [Fact]
    public void DetectSwingPercent_BelowMinimumLotsInMostRecentSale_IsNotDetected()
    {
        // Only 3 lots in the most recent sale — below the 5-lot noise floor, even though
        // the percentage swing itself would be large.
        Assert.Null(PerformanceEngine.DetectSwingPercent(3, [1]));
    }

    [Fact]
    public void DetectSwingPercent_SwingBelowPercentFloor_IsNotDetected()
    {
        // 10 vs prior average 9.5 -> ~5% swing, below the 20% floor.
        Assert.Null(PerformanceEngine.DetectSwingPercent(10, [9, 10]));
    }

    [Fact]
    public void DetectSwingPercent_NoPriorHistory_IsNotDetected()
    {
        Assert.Null(PerformanceEngine.DetectSwingPercent(10, []));
    }
}
