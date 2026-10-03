using Asc.Api.Models;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class LotListAnswerTests
{
    private static readonly Lot[] Lots =
    [
        new() { Broker = "ASC", LotNumber = "273", Grade = "OPA", FactoryName = "NEW BADDEGAMA", Factory = "MF1513", SellingMark = "NEW BADDEGAMA SUPER", Bags = 10, NetWeight = 240, Status = "Pending", Category = "High and Medium", Elevation = "WM" },
        new() { Broker = "ASC", LotNumber = "12", Grade = "BOPF", FactoryName = "ROBGILL ESTATE", Factory = "MF0294", Bags = 10, NetWeight = 580 },
        new() { Broker = "FW", LotNumber = "5", Grade = "BOP", FactoryName = "NEW BADDEGAMA", Factory = "MF1513", Bags = 4, NetWeight = 96 },
    ];
    private static readonly NameIndex Index = NameIndex.From(Lots);

    [Fact]
    public void TheLotsOfAFactory_AreATable_OfExactRows()
    {
        var reply = LotListAnswer.Reply("give me the lots of New Baddegama in sale 41", Lots, Index, "sale 41/2026")!;
        Assert.StartsWith("2 lots for NEW BADDEGAMA in sale 41/2026.", reply);
        Assert.Contains("| ASC | 273 | OPA | WM | High and Medium | NEW BADDEGAMA SUPER | NEW BADDEGAMA (MF1513) | 10 | 240 | Pending |", reply);
        Assert.DoesNotContain("ROBGILL", reply);
        Assert.Contains("Scope: sale 41/2026", reply);
    }

    [Fact]
    public void AQuestionWithNoNameOrNoListWord_IsNotTakenHere()
    {
        Assert.Null(LotListAnswer.Reply("top price for BOP1A", Lots, Index, "sale 41/2026"));
        Assert.Null(LotListAnswer.Reply("lots of Nobody Estate", Lots, Index, "sale 41/2026"));
    }
}

public class LotListFiltersTests
{
    private static readonly Lot[] Lots =
    [
        new() { Broker = "ASC", LotNumber = "1", Grade = "BOPF", Category = "Leafy", Elevation = "UVA HIGH", FactoryName = "Alpha" },
        new() { Broker = "ASC", LotNumber = "2", Grade = "OP", Category = "High and Medium", Elevation = "LOW", FactoryName = "Beta" },
        new() { Broker = "FW", LotNumber = "3", Grade = "BOPF", Category = "Leafy", Elevation = "UVA HIGH", FactoryName = "Gamma" },
    ];
    private static readonly NameIndex Index = NameIndex.From(Lots);

    [Fact]
    public void FiltersCombine_BrokerGradeAndElevation()
    {
        var reply = LotListAnswer.Reply("show me the ASC BOPF lots in UVA HIGH", Lots, Index, "sale 41/2026")!;
        Assert.StartsWith("1 lot for ASC, BOPF, UVA HIGH in sale 41/2026.", reply);
        Assert.Contains("| ASC | 1 | BOPF |", reply);
    }

    [Fact]
    public void ACategoryListIsAnswered_AndNoFilterMeansNoList()
    {
        Assert.Contains("| ASC | 2 | OP |", LotListAnswer.Reply("all High and Medium lots", Lots, Index, "sale 41/2026")!);
        Assert.Null(LotListAnswer.Reply("what is the trend of prices", Lots, Index, "sale 41/2026"));
    }
}
