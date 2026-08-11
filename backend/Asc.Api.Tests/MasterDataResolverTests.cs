using Asc.Api.Modules.MasterData;

namespace Asc.Api.Tests;

public class MasterDataResolverTests
{
    private static MasterDataEntity Broker(string canonicalName, params string[] aliases) => new()
    {
        Type = MasterDataEntityType.Broker,
        CanonicalName = canonicalName,
        Aliases = [.. aliases],
    };

    [Fact]
    public void BuildIndex_MapsCanonicalNameAndEveryAliasToTheCanonicalName()
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd", "A.B.C. Ltd", "ABC LIMITED")]);

        Assert.Equal("ABC Ltd", index[(MasterDataEntityType.Broker, MasterDataNormalizer.NormalizeKey("ABC Ltd"))]);
        Assert.Equal("ABC Ltd", index[(MasterDataEntityType.Broker, MasterDataNormalizer.NormalizeKey("A.B.C. Ltd"))]);
        Assert.Equal("ABC Ltd", index[(MasterDataEntityType.Broker, MasterDataNormalizer.NormalizeKey("ABC LIMITED"))]);
    }

    [Fact]
    public void ResolveFrom_ReturnsCanonicalNameForAnAliasSpellingVariant()
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd", "A.B.C. Ltd", "ABC LIMITED")]);

        Assert.Equal("ABC Ltd", MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Broker, "a.b.c.  ltd"));
        Assert.Equal("ABC Ltd", MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Broker, "ABC Limited"));
    }

    [Fact]
    public void ResolveFrom_UnmappedValueFallsThroughUnchangedButTrimmed()
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd", "A.B.C. Ltd")]);

        Assert.Equal("Some Other Broker", MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Broker, "  Some Other Broker  "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveFrom_BlankInputPassesThroughUnchanged(string? raw)
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd")]);
        Assert.Equal(raw, MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Broker, raw));
    }

    [Fact]
    public void ResolveFrom_DoesNotCrossEntityTypeBoundaries()
    {
        var index = MasterDataResolver.BuildIndex(
        [
            Broker("ABC Ltd"),
            new MasterDataEntity { Type = MasterDataEntityType.Garden, CanonicalName = "ABC Ltd" }, // same text, different type
        ]);

        // Both resolve fine independently — the point is a lookup for one type never lands on
        // the other's row purely because the normalized text happens to collide.
        Assert.Equal("ABC Ltd", MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Broker, "ABC Ltd"));
        Assert.Equal("ABC Ltd", MasterDataResolver.ResolveFrom(index, MasterDataEntityType.Garden, "ABC Ltd"));
        Assert.False(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Grade, "ABC Ltd"));
    }

    [Fact]
    public void IsMappedIn_TrueForCanonicalNameAndAlias_FalseForUnmappedValue()
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd", "A.B.C. Ltd")]);

        Assert.True(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Broker, "ABC Ltd"));
        Assert.True(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Broker, "a.b.c. ltd"));
        Assert.False(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Broker, "Some Other Broker"));
    }

    [Fact]
    public void IsMappedIn_TreatsBlankAsVacuouslyMapped()
    {
        // MasterDataController's "unmapped values" scan already skips blank raw values before
        // calling IsMapped — this just confirms the vacuous case can never itself flag a blank
        // as an "unmapped value" if that guard were ever removed.
        var index = MasterDataResolver.BuildIndex([]);
        Assert.True(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Broker, null));
        Assert.True(MasterDataResolver.IsMappedIn(index, MasterDataEntityType.Broker, "   "));
    }

    [Fact]
    public void Resolve_UsesTheSeededIndexWithoutTouchingMongo()
    {
        var index = MasterDataResolver.BuildIndex([Broker("ABC Ltd", "A.B.C. Ltd")]);
        var resolver = new MasterDataResolver(null!, index);

        Assert.Equal("ABC Ltd", resolver.Resolve(MasterDataEntityType.Broker, "A.B.C. Ltd"));
        Assert.True(resolver.IsMapped(MasterDataEntityType.Broker, "ABC Ltd"));
        Assert.False(resolver.IsMapped(MasterDataEntityType.Broker, "Unrelated Co"));
    }
}
