using Asc.Api.Modules.Deadlines;

namespace Asc.Api.Tests;

public class DeadlineEngineTests
{
    [Fact]
    public void DetermineLevel_FarOut_ReturnsNull()
    {
        Assert.Null(DeadlineEngine.DetermineLevel(TimeSpan.FromDays(5), alreadyNotifiedLevel: 0));
    }

    [Fact]
    public void DetermineLevel_Crosses48Hours_ReturnsLevel1()
    {
        var result = DeadlineEngine.DetermineLevel(TimeSpan.FromHours(47), alreadyNotifiedLevel: 0);

        Assert.NotNull(result);
        Assert.Equal(1, result.Value.Level);
        Assert.Equal("normal", result.Value.Priority);
    }

    [Fact]
    public void DetermineLevel_Crosses24Hours_ReturnsLevel2()
    {
        var result = DeadlineEngine.DetermineLevel(TimeSpan.FromHours(23), alreadyNotifiedLevel: 1);

        Assert.NotNull(result);
        Assert.Equal(2, result.Value.Level);
    }

    [Fact]
    public void DetermineLevel_Crosses4Hours_ReturnsLevel3WithHighPriority()
    {
        var result = DeadlineEngine.DetermineLevel(TimeSpan.FromHours(3), alreadyNotifiedLevel: 2);

        Assert.NotNull(result);
        Assert.Equal(3, result.Value.Level);
        Assert.Equal("high", result.Value.Priority);
    }

    [Fact]
    public void DetermineLevel_SkipsStraightToTheMostUrgentCrossedRung()
    {
        // Never notified before, but already only 3 hours out — should jump straight to
        // level 3, not queue up levels 1 and 2 behind it.
        var result = DeadlineEngine.DetermineLevel(TimeSpan.FromHours(3), alreadyNotifiedLevel: 0);

        Assert.NotNull(result);
        Assert.Equal(3, result.Value.Level);
    }

    [Fact]
    public void DetermineLevel_AlreadyNotifiedAtThisLevel_ReturnsNull()
    {
        Assert.Null(DeadlineEngine.DetermineLevel(TimeSpan.FromHours(47), alreadyNotifiedLevel: 1));
    }

    [Fact]
    public void DetermineLevel_AlreadyNotifiedAtAMoreUrgentLevel_ReturnsNull()
    {
        // Time somehow ticked back into a less-urgent bracket (shouldn't happen in practice,
        // but the level already reached must never un-escalate).
        Assert.Null(DeadlineEngine.DetermineLevel(TimeSpan.FromHours(47), alreadyNotifiedLevel: 3));
    }

    [Fact]
    public void DetermineLevel_NegativeRemaining_ReturnsMissed()
    {
        var result = DeadlineEngine.DetermineLevel(TimeSpan.FromHours(-1), alreadyNotifiedLevel: 3);

        Assert.NotNull(result);
        Assert.Equal(DeadlineEngine.MissedLevel, result.Value.Level);
        Assert.Equal("high", result.Value.Priority);
    }

    [Fact]
    public void DetermineLevel_AlreadyNotifiedMissed_ReturnsNull()
    {
        Assert.Null(DeadlineEngine.DetermineLevel(TimeSpan.FromHours(-2), alreadyNotifiedLevel: DeadlineEngine.MissedLevel));
    }
}
