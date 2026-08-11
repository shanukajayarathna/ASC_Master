using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.MasterData;

/// <summary>
/// In-memory alias -> canonical-name lookup, rebuilt from Mongo at startup (see Program.cs)
/// and again by MasterDataController after every admin write. Resolution has to be
/// synchronous and cheap since it runs inside LINQ grouping selectors (Analytics/Market/
/// Reports), so the whole table — a few hundred rows across nine entity types at most — is
/// held in memory rather than queried per lookup, the same "fine at this scale" call made by
/// DocumentSearchService's brute-force embedding search.
/// A raw value with no matching alias resolves to itself (trimmed): unmapped data behaves
/// exactly as it does today, this is additive, never a hard failure.
/// The actual matching logic (BuildIndex/ResolveFrom/IsMappedIn) is pure and static so
/// Asc.Api.Tests can exercise it without a MongoDB instance — see InternalsVisibleTo in
/// Asc.Api.csproj.
/// </summary>
public class MasterDataResolver(MongoContext db)
{
    private readonly object _lock = new();
    private IReadOnlyDictionary<(MasterDataEntityType Type, string NormalizedKey), string> _index =
        new Dictionary<(MasterDataEntityType, string), string>();

    /// <summary>Test-only seam: builds a resolver pre-loaded with a known index, bypassing
    /// Mongo entirely, so tests can exercise Resolve/IsMapped (and callers like
    /// AnalyticsController.ComputeBrokerStats that take a MasterDataResolver) in isolation.</summary>
    internal MasterDataResolver(MongoContext db, IReadOnlyDictionary<(MasterDataEntityType, string), string> seedIndex) : this(db)
    {
        _index = seedIndex;
    }

    public string? Resolve(MasterDataEntityType type, string? raw)
    {
        IReadOnlyDictionary<(MasterDataEntityType, string), string> snapshot;
        lock (_lock) snapshot = _index;
        return ResolveFrom(snapshot, type, raw);
    }

    /// <summary>True only when raw already resolves to some canonical entity (itself or via an
    /// alias) — distinct from Resolve's return value, since a raw value that happens to equal
    /// its own canonical name and a genuinely-unmapped value can otherwise look identical to a
    /// caller that only compares strings. Used by MasterDataController's "unmapped values"
    /// discovery endpoint.</summary>
    public bool IsMapped(MasterDataEntityType type, string? raw)
    {
        IReadOnlyDictionary<(MasterDataEntityType, string), string> snapshot;
        lock (_lock) snapshot = _index;
        return IsMappedIn(snapshot, type, raw);
    }

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        var entities = await db.MasterDataEntities.Find(FilterDefinition<MasterDataEntity>.Empty).ToListAsync(ct);
        var index = BuildIndex(entities);
        lock (_lock) _index = index;
    }

    /// <summary>Every alias, plus the canonical name itself, normalized to a lookup key. Pure —
    /// no Mongo dependency — so this is the seam Asc.Api.Tests exercises directly.</summary>
    internal static Dictionary<(MasterDataEntityType, string), string> BuildIndex(IEnumerable<MasterDataEntity> entities)
    {
        var index = new Dictionary<(MasterDataEntityType, string), string>();
        foreach (var entity in entities)
        {
            index[(entity.Type, MasterDataNormalizer.NormalizeKey(entity.CanonicalName))] = entity.CanonicalName;
            foreach (var alias in entity.Aliases)
                index[(entity.Type, MasterDataNormalizer.NormalizeKey(alias))] = entity.CanonicalName;
        }
        return index;
    }

    internal static string? ResolveFrom(IReadOnlyDictionary<(MasterDataEntityType, string), string> index, MasterDataEntityType type, string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return raw;
        return index.TryGetValue((type, MasterDataNormalizer.NormalizeKey(raw)), out var canonical) ? canonical : raw.Trim();
    }

    internal static bool IsMappedIn(IReadOnlyDictionary<(MasterDataEntityType, string), string> index, MasterDataEntityType type, string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return true;
        return index.ContainsKey((type, MasterDataNormalizer.NormalizeKey(raw)));
    }
}
