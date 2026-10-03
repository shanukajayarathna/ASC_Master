using Asc.Api.Models;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Tests;

public class NameIndexTests
{
    private static readonly NameIndex Index = NameIndex.From(
    [
        new Lot { FactoryName = "New Baddegama", Mark = "NB", BuyerName = "Mackwoods" },
        new Lot { FactoryName = "Aruna Tea Factory", Mark = "Aruna", SellingMark = "Aruna" },
        new Lot { FactoryName = "Glen Alpin", Mark = "Glen Alpin" },
    ]);

    [Fact]
    public void AFactoryNameIsFoundAsAFactory()
    {
        var m = Index.Find("ASC lots for New Baddegama in sale 41");
        Assert.Equal("New Baddegama", m[0].Name);
        Assert.Equal([NameKind.Factory], m[0].Kinds);
    }

    [Fact]
    public void AName_UsedAsFactoryAndMark_IsReportedWithBothKinds_SoTheAssistantAsks()
    {
        var m = Index.Find("what is the grade mix of Glen Alpin");
        Assert.Equal([NameKind.Factory, NameKind.Mark], m[0].Kinds);
    }

    [Fact]
    public void ABuyerIsFound_AndWordsThatAreNoNameAreNot()
    {
        Assert.Equal([NameKind.Buyer], Index.Find("who bought from Mackwoods").Single().Kinds);
        Assert.Empty(Index.Find("what is the top price for BOP"));
    }

    [Fact]
    public void TheLongestNameWins()
    {
        var m = Index.Find("Aruna Tea Factory lots");
        Assert.Single(m);
        Assert.Equal("Aruna Tea Factory", m[0].Name);
    }
}
