using Asc.Api.Services;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Factory reference data derived from the weekly sale Excel catalogues ("use the data
/// files"): factory code → plantation group (the Excel "Producer" column) and factory
/// name. Factory codes are stable across years, so a mapping learned from current
/// catalogues applies to the whole MSL archive. Built lazily on first use, then cached;
/// Refresh() rebuilds after new catalogues arrive.
/// </summary>
public class MslReferenceService(ICatalogueSource catalogues, ILogger<MslReferenceService> logger)
{
    public record FactoryRef(string FactoryCode, string? Group, string? FactoryName);

    private volatile IReadOnlyDictionary<string, FactoryRef>? _byFactory;
    private readonly Lock _buildLock = new();

    public IReadOnlyDictionary<string, FactoryRef> ByFactory
    {
        get
        {
            if (_byFactory is { } cached) return cached;
            lock (_buildLock)
            {
                if (_byFactory is { } inner) return inner;
                _byFactory = Build();
                return _byFactory;
            }
        }
    }

    public void Refresh()
    {
        lock (_buildLock)
        {
            _byFactory = Build();
        }
    }

    /// <summary>All known plantation groups → their factory codes (for the group filter).</summary>
    public Dictionary<string, List<string>> GroupToFactories()
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in ByFactory.Values)
        {
            if (string.IsNullOrWhiteSpace(f.Group)) continue;
            (result.TryGetValue(f.Group, out var list) ? list : result[f.Group] = []).Add(f.FactoryCode);
        }
        return result;
    }

    private Dictionary<string, FactoryRef> Build()
    {
        var map = new Dictionary<string, FactoryRef>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var cat in catalogues.ListCatalogues())
            {
                var lots = catalogues.GetLots(cat.Id);
                if (lots is null) continue;
                foreach (var lot in lots)
                {
                    var code = lot.Factory?.Replace(" ", "");
                    if (string.IsNullOrWhiteSpace(code) || map.ContainsKey(code)) continue;
                    lot.RawData.TryGetValue("Producer", out var producer);
                    map[code] = new FactoryRef(
                        code,
                        string.IsNullOrWhiteSpace(producer) ? null : producer.Trim(),
                        string.IsNullOrWhiteSpace(lot.FactoryName) ? null : lot.FactoryName.Trim());
                }
            }
            logger.LogInformation("MSL factory reference built: {Count} factories, {Groups} with a plantation group",
                map.Count, map.Values.Count(f => f.Group is not null));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Factory reference build failed — group filters will be empty until catalogues load");
        }
        return map;
    }
}
