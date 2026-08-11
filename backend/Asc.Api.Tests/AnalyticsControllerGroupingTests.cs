using Asc.Api.Models;
using Asc.Api.Modules.Analytics;
using Asc.Api.Modules.MasterData;

namespace Asc.Api.Tests;

public class AnalyticsControllerGroupingTests
{
    private static (Lot Lot, Valuation? Val) LotWithValue(string? broker, string? grade, string? category, decimal netWeight, decimal value) =>
        (new Lot { Broker = broker, Grade = grade, Category = category, NetWeight = netWeight },
         new Valuation { ValuationSingle = value });

    [Fact]
    public void ComputeBrokerStats_MergesAliasedBrokerSpellingsIntoOneRow()
    {
        var masterData = new MasterDataResolver(null!, MasterDataResolver.BuildIndex(
        [
            new MasterDataEntity { Type = MasterDataEntityType.Broker, CanonicalName = "ABC Ltd", Aliases = ["A.B.C. Ltd"] },
        ]));

        var merged = new List<(Lot Lot, Valuation? Val)>
        {
            LotWithValue("ABC Ltd", "BOP1", "High", 10, 100),
            LotWithValue("A.B.C. Ltd", "BOP1", "High", 20, 200), // same broker, different spelling
            LotWithValue("XYZ Ltd", "PEKOE", "Low", 5, 50),
        };

        var stats = AnalyticsController.ComputeBrokerStats(merged, masterData);

        var abc = Assert.Single(stats, s => s.Name == "ABC Ltd");
        Assert.Equal(2, abc.Lots);
        Assert.Equal(150m, abc.Avg);
        Assert.Equal(30m, abc.NetWeight);
        Assert.Equal("BOP1", abc.TopGrade);
        Assert.Equal("High", abc.TopCategory);

        // The unmapped broker is untouched — this is additive, not a hard requirement to map everything.
        Assert.Single(stats, s => s.Name == "XYZ Ltd");
        Assert.DoesNotContain(stats, s => s.Name == "A.B.C. Ltd");
    }

    [Fact]
    public void ComputeBrokerStats_BlankBrokerFallsBackToUnspecified()
    {
        var masterData = new MasterDataResolver(null!, MasterDataResolver.BuildIndex([]));
        var merged = new List<(Lot Lot, Valuation? Val)> { LotWithValue(null, "BOP1", "High", 10, 100) };

        var stats = AnalyticsController.ComputeBrokerStats(merged, masterData);

        Assert.Equal("(unspecified)", Assert.Single(stats).Name);
    }
}
