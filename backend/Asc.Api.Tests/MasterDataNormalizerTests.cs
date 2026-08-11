using Asc.Api.Modules.MasterData;

namespace Asc.Api.Tests;

public class MasterDataNormalizerTests
{
    [Theory]
    [InlineData("ABC Ltd", "A.B.C. Ltd")]
    [InlineData("ABC Ltd", "abc ltd")]
    [InlineData("ABC Ltd", "  ABC   Ltd  ")]
    [InlineData("ABC Ltd", "ABC-LTD")]
    public void NormalizeKey_TreatsCasePunctuationAndWhitespaceVariantsAsEqual(string a, string b)
    {
        Assert.Equal(MasterDataNormalizer.NormalizeKey(a), MasterDataNormalizer.NormalizeKey(b));
    }

    [Fact]
    public void NormalizeKey_DistinguishesGenuinelyDifferentValues()
    {
        Assert.NotEqual(MasterDataNormalizer.NormalizeKey("ABC Ltd"), MasterDataNormalizer.NormalizeKey("XYZ Ltd"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void NormalizeKey_BlankInputNormalizesToEmptyString(string? value)
    {
        Assert.Equal(string.Empty, MasterDataNormalizer.NormalizeKey(value));
    }
}
