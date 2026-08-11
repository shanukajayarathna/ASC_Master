namespace Asc.Api.Modules.MasterData;

/// <summary>
/// Strip-to-alphanumeric-and-lowercase key used to match aliases regardless of case,
/// punctuation, or whitespace (e.g. "A.B.C. Ltd" and "ABC LIMITED" both normalize to
/// "abcltd"/"abclimited" — close enough for an admin-curated alias list to bridge). Same idea
/// as TopPriceEngine's own NormalizeKey, kept as a separate copy rather than shared: that
/// method is private and TopPriceEngine is intentionally left untouched by this module (see
/// the Master Data plan's scope notes) since it's a faithful port of legacy JS verified
/// against real report output.
/// </summary>
public static class MasterDataNormalizer
{
    public static string NormalizeKey(string? value) =>
        new([.. (value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit)]);
}
