using Asc.Api.Models;
using Asc.Api.Modules.MarkIntelligence;

namespace Asc.Api.Tests;

public class SharedMarkCataloguePercentEngineTests
{
    private static Lot Lot(string code, string sellingMark, string broker, decimal netWeight,
        bool isReprint = false, string? factoryName = null) => new()
    {
        Factory = SharedMarkCatalogueService.NormalizeMarkCode(code),
        Mark = code,
        FactoryName = factoryName,
        SellingMark = sellingMark,
        Broker = broker,
        NetWeight = netWeight,
        IsReprint = isReprint,
    };

    [Fact]
    public void SingleBrokerFactory_IsExcluded_NotAShare()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0020", "RANSIRINI", "ASC", 500),
        ]);

        Assert.Empty(result.Rows);
    }

    [Fact]
    public void TwoBrokerFactory_ComputesPercentSplit()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0020", "RANSIRINI", "ASC", 300),
            Lot("MF0020", "RANSIRINI", "EB", 700),
        ]);

        var row = Assert.Single(result.Rows);
        Assert.Equal(1000, row.TotalQty);
        Assert.Equal(30m, row.PercentByBroker["ASC"]);
        Assert.Equal(70m, row.PercentByBroker["EB"]);
        Assert.Contains("ASC", result.Brokers);
        Assert.Contains("EB", result.Brokers);
    }

    [Fact]
    public void ReprintLots_AreExcludedFromTotals_ByDefault()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0020", "RANSIRINI", "ASC", 497, isReprint: true),
            Lot("MF0020", "RANSIRINI", "EB", 500),
        ]);

        Assert.Empty(result.Rows);
    }

    [Fact]
    public void ReprintLots_AreIncluded_WhenIncludeReprintsIsTrue()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0020", "RANSIRINI", "ASC", 497, isReprint: true),
            Lot("MF0020", "RANSIRINI", "EB", 500),
        ], includeReprints: true);

        var row = Assert.Single(result.Rows);
        Assert.Equal(997, row.TotalQty);
        Assert.Equal(497, row.QtyByBroker["ASC"]);
    }

    [Fact]
    public void DifferentSubMarksUnderSameFactory_MergeIntoOneRow()
    {
        // Same real-data pattern SharedMarkCatalogueService relies on: MF0594 (Boscombe) and
        // MF0594A (Kinkini) share one Factory code and must roll into a single row here too.
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0594", "BOSCOMBE", "ASC", 400),
            Lot("MF0594A", "KINKINI", "EB", 600),
        ]);

        var row = Assert.Single(result.Rows);
        Assert.Equal(1000, row.TotalQty);
    }

    [Fact]
    public void FactoryName_PreferredOverSellingMark_ForDisplay()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0020", "RANSIRINI", "ASC", 300, factoryName: "Watadeniya Tea Factory"),
            Lot("MF0020", "RANSIRINI", "EB", 700),
        ]);

        var row = Assert.Single(result.Rows);
        Assert.Equal("Watadeniya Tea Factory", row.FactoryName);
    }

    [Fact]
    public void Rows_AreSortedAlphabeticallyByFactoryName()
    {
        var result = SharedMarkCataloguePercentEngine.Build([
            Lot("MF0002", "ZEBRA ESTATE", "ASC", 100),
            Lot("MF0002", "ZEBRA ESTATE", "EB", 100),
            Lot("MF0001", "ALPHA ESTATE", "ASC", 100),
            Lot("MF0001", "ALPHA ESTATE", "EB", 100),
        ]);

        Assert.Equal(["Alpha Estate", "Zebra Estate"], result.Rows.Select(r => r.FactoryName));
    }
}
