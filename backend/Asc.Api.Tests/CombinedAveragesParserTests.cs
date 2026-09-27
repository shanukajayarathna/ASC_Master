using Asc.Api.Modules.Msl.CombinedAverages;

namespace Asc.Api.Tests;

public class CombinedAveragesParserTests
{
    private static string Report(string brokerTotal = "300.00") => string.Join(Environment.NewLine,
        "* COLOMBO BROKERS ASSO. *     GROSS AVERAGES FOR THE MONTH OF FEBRUARY,2019",
        "                              **********************************************",
        "LANKA COMMODITY BROKERS LTD                                           PAGE--   1",
        "F A C T O R Y  M A R K   Q U A N T I T Y        G R O S S        C O M B I N E D",
        "**********************   ***************        ***************  ***************",
        "ORANGE FIELD                    100.00               60,000.00          600.00",
        "BF0028                                                 UNIT RATE         15.000",
        "         SELLING MARK:       ORANGE FIELD",
        "********************************************************************************",
        "HIGH FOREST                     200.00              120,000.00          600.00",
        "MF0008                                                 UNIT RATE         15.000",
        "         SELLING MARK:       HIGH FOREST CTC",
        "********************************************************************************",
        $"         TOTAL                    {brokerTotal}              180,000.00          600.00",
        "         HIGH - UVA                   200.00              120,000.00          600.00",
        "         LOW                          100.00               60,000.00          600.00",
        "* COLOMBO BROKERS ASSO. *     GROSS AVERAGES FOR THE MONTH OF FEBRUARY,2019",
        "ASIA SIYAKA COMMODITIES PLC                                           PAGE--  86",
        "         GRAND TOTALS                 300.00              180,000.00          600.00",
        "         HIGH - UVA                   200.00              120,000.00          600.00");

    [Fact]
    public void Parse_ReadsFactoriesMarksTotalsAndTheGrandBlock()
    {
        var p = CombinedAveragesParser.Parse(Report(), "combined-averages-2019-02.txt")!;

        Assert.Equal((2019, 2), (p.Year, p.Month));
        var factories = p.Rows.Where(r => r.RowType == CombinedAverageRowType.Factory).ToList();
        Assert.Equal(2, factories.Count);
        var orange = factories[0];
        Assert.Equal(("LANKA COMMODITY BROKERS LTD", "ORANGE FIELD", "BF0028", "ORANGE FIELD"), (orange.Broker, orange.Factory, orange.MfCode, orange.SellingMark));
        Assert.Equal((100.00m, 60_000.00m, 600.00m, 15.000m), (orange.QuantityKg, orange.GrossProceedsRs, orange.AvgRs, orange.UnitRate));

        // A factory whose name starts with a total-line word ("HIGH FOREST") is still a factory.
        Assert.Equal("HIGH FOREST", factories[1].Factory);

        Assert.Equal(2, p.Rows.Count(r => r.RowType == CombinedAverageRowType.BrokerElevation));
        Assert.Contains(p.Rows, r => r.RowType == CombinedAverageRowType.BrokerElevation && r.Elevation == "HIGH - UVA");

        // Lines after GRAND TOTALS belong to the all-broker block, not to the broker whose header precedes it.
        var grand = p.Rows.Single(r => r.RowType == CombinedAverageRowType.GrandTotal);
        Assert.Null(grand.Broker);
        Assert.Equal(300.00m, grand.QuantityKg);
        Assert.Contains(p.Rows, r => r.RowType == CombinedAverageRowType.GrandElevation && r.Elevation == "HIGH - UVA");
    }

    [Fact]
    public void Reconcile_AcceptsBalancedAndFlagsUnbalanced()
    {
        Assert.Empty(CombinedAveragesParser.Reconcile(CombinedAveragesParser.Parse(Report(), "x")!));

        var bad = CombinedAveragesParser.Parse(Report(brokerTotal: "999.00"), "x")!;
        Assert.Contains(CombinedAveragesParser.Reconcile(bad), m => m.StartsWith("LANKA COMMODITY BROKERS LTD: factories add to 300.00", StringComparison.Ordinal));
    }

    [Fact]
    public void Parse_ReturnsNullForOtherReports_AndThrowsOnAnUnknownLine()
    {
        Assert.Null(CombinedAveragesParser.Parse("FACTORY WISE AVERAGES FOR MARCH 2019", "x"));
        Assert.Throws<FormatException>(() => CombinedAveragesParser.Parse(Report() + Environment.NewLine + "SOMETHING UNEXPECTED HERE", "x"));
    }
}
