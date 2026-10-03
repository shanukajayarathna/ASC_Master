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

public class FactoryCodeTests
{
    [Fact]
    public void TheFactoryCodeIsFoundWithItsFactory()
    {
        var index = NameIndex.From([new Asc.Api.Models.Lot { FactoryName = "New Baddegama", Factory = "MFA0300" }]);
        var m = index.Find("what is the mf code for New Baddegama").Single();
        Assert.Equal("New Baddegama", m.Name);
        Assert.Equal("MFA0300", m.Code);
        Assert.Equal("New Baddegama", index.Find("MFA0300").Single().Name);
    }
}

public class FactoryLookupTests
{
    private static readonly NameIndex Index = NameIndex.From(
    [
        new Asc.Api.Models.Lot { FactoryName = "New Baddegama", Factory = "MFA0300" },
        new Asc.Api.Models.Lot { FactoryName = "Glen Alpin", Factory = "MFB0121" },
    ]);

    [Fact]
    public void AnExactFactoryCodeQuestion_IsAnsweredFromTheLots()
    {
        Assert.Equal("New Baddegama's MF code is MFA0300 (from the Factory column, sale 41/2026).", FactoryLookup.Reply("what is the mf code for New Baddegama", Index, "sale 41/2026"));
    }

    [Fact]
    public void AMisspelling_IsConfirmedNotAnswered()
    {
        var reply = FactoryLookup.Reply("what is the mf code for New Baddegaama", Index, "sale 41/2026")!;
        Assert.StartsWith("I couldn't find an exact match. Did you mean New Baddegama?", reply);
        Assert.Contains("MFA0300", reply);
    }

    [Fact]
    public void ANonFactoryQuestion_IsNotTakenHere_AndAnUnknownNameSaysSo()
    {
        Assert.Null(FactoryLookup.Reply("top price for BOP1A", Index, "sale 41/2026"));
        Assert.Contains("couldn't find a factory", FactoryLookup.Reply("mf code for Zzzzzz Tea Estate Plantations", Index, "sale 41/2026")!);
    }
}
