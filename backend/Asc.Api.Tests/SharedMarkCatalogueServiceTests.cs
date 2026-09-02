using Asc.Api.Models;
using Asc.Api.Modules.MarkIntelligence;

namespace Asc.Api.Tests;

public class SharedMarkCatalogueServiceTests
{
    private static Lot Lot(string factory, string sellingMark, string broker, decimal netWeight,
        bool isReprint = false, string elevation = "L") => new()
    {
        Factory = factory,
        SellingMark = sellingMark,
        Broker = broker,
        NetWeight = netWeight,
        IsReprint = isReprint,
        Elevation = elevation,
    };

    private static IReadOnlyList<SharedMarkCatalogueRow> Build(params Lot[] lots) =>
        SharedMarkCatalogueService.BuildRows(lots.Select(l => (l, IsTargetSale: true, IsThisMonth: true)));

    [Fact]
    public void ReprintLots_AreExcludedFromTotals()
    {
        // Real Sale 36/2026 case: Ransirini's only ASC lot was a reprint — the estate must
        // not appear at all (no non-reprint ASC volume to compare against MC's).
        var rows = Build(
            Lot("MF0020A", "RANSIRINI", "ASC", 497, isReprint: true),
            Lot("MF0020A", "RANSIRINI", "MC", 500));

        Assert.Empty(rows);
    }

    [Fact]
    public void SharedMarkCode_NeverMerges_EvenWhenLikelySameEstate()
    {
        // Deliberate, per explicit instruction: an earlier version merged Selling Marks
        // sharing a base Trade Mark/Factory code (e.g. "GREEN MOUNT" / "GREEN MOUNT SUPER"
        // both under MF1188), on the theory a trailing letter marks a sibling brand. Real
        // Sale 36/2026 data proved that theory wrong for other pairs sharing the exact same
        // code pattern (Greenwood/MF1044 vs Midfield/MF1044A are unrelated estates; merging
        // silently hid Greenwood's real shared-mark row under "Midfield"). There's no way to
        // tell a true sibling pair from a coincidental code-block neighbor from the code
        // alone, so grouping is by exact Selling Mark text only — never merged, even here.
        var rows = Build(
            Lot("MF1188", "GREEN MOUNT", "ASC", 880),
            Lot("MF1188", "GREEN MOUNT SUPER", "ASC", 940),
            Lot("MF1188", "GREEN MOUNT", "BC", 1000),
            Lot("MF1188", "GREEN MOUNT SUPER", "BC", 1200));

        Assert.Equal(2, rows.Count);
        Assert.Equal(880, rows.Single(r => r.EstateName == "Green Mount").SaleQtyByBroker["ASC"]);
        Assert.Equal(940, rows.Single(r => r.EstateName == "Green Mount Super").SaleQtyByBroker["ASC"]);
    }

    [Fact]
    public void CtcSellingMark_IsItsOwnRow_LikeAnyOtherDistinctMark()
    {
        var rows = Build(
            Lot("MF1465", "BROMBIL", "ASC", 5596, elevation: "L"),
            Lot("MF1465", "BROMBIL", "CT", 500, elevation: "L"),
            Lot("MF1465", "BROMBIL CTC", "ASC", 9600, elevation: "L"),
            Lot("MF1465", "BROMBIL CTC", "CT", 300, elevation: "L"));

        Assert.Equal(2, rows.Count);
        Assert.Equal(5596, rows.Single(r => r.EstateName == "Brombil").SaleQtyByBroker["ASC"]);
        Assert.Equal(9600, rows.Single(r => r.EstateName == "Brombil Ctc").SaleQtyByBroker["ASC"]);
    }

    [Fact]
    public void EstateWithNoOtherBroker_IsExcluded_NotAShareYet()
    {
        var rows = Build(Lot("MF0001", "SOLO ESTATE", "ASC", 1000));
        Assert.Empty(rows);
    }

    [Fact]
    public void ElevationBucket_LowVsHighAndMedium_SplitsByRawSubElevation()
    {
        var rows = Build(
            Lot("MF0001", "LOW ESTATE", "ASC", 100, elevation: "L"),
            Lot("MF0001", "LOW ESTATE", "JK", 100, elevation: "L"),
            Lot("MF0002", "HIGH ESTATE", "ASC", 100, elevation: "WH"),
            Lot("MF0002", "HIGH ESTATE", "JK", 100, elevation: "WH"));

        Assert.Equal("Low Grown", rows.Single(r => r.EstateName == "Low Estate").ElevationBucket);
        Assert.Equal("High & Medium Grown", rows.Single(r => r.EstateName == "High Estate").ElevationBucket);
    }
}
