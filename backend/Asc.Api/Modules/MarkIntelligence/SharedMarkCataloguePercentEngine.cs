using Asc.Api.Models;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Pure aggregation for the "Shared Mark Catalogues % Broker-wise" report: for every factory
/// catalogued by two or more brokers in the selected scope (one sale, a month, a year, or a
/// sale-to-sale range), what percentage of that factory's total catalogued quantity each broker
/// carried. A single-broker factory isn't "shared" at all, so it's dropped rather than shown at
/// 100% under one column — the report is about splits between brokers, not a full catalogue
/// listing.
///
/// Grouping reuses SharedMarkCatalogueService's own Factory-code logic (GroupKey/
/// NormalizeMarkCode: group by the producing factory's own code, not the Trade Mark, so
/// differently-coded sub-marks under one factory still count as one row) but — unlike that
/// report — makes no Orthodox/CTC split: this report only cares about broker share, not
/// production type, so every lot under a factory code folds into one row regardless.
/// </summary>
public static class SharedMarkCataloguePercentEngine
{
    public static SharedMarkCataloguePercentDto Build(IEnumerable<Lot> lots)
    {
        var groups = new Dictionary<string, Accumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var lot in lots)
        {
            if (lot.IsReprint) continue;
            if (lot.NetWeight is not { } qty || qty <= 0) continue;
            if (string.IsNullOrWhiteSpace(lot.Broker)) continue;
            var key = GroupKey(lot);
            if (key is null) continue;

            if (!groups.TryGetValue(key, out var acc))
                groups[key] = acc = new Accumulator { Code = key };

            // Prefer the real Factory Name column over free-text Selling Mark, first-seen-wins,
            // upgrading the moment a real Factory Name shows up — same rule as
            // SharedMarkCatalogueService.BuildRows, minus its CTC exception (this report never
            // splits a factory, so there's no CTC-side label to protect).
            if (!string.IsNullOrWhiteSpace(lot.FactoryName) && !acc.NameIsFactoryName)
            {
                acc.Name = lot.FactoryName.Trim();
                acc.NameIsFactoryName = true;
            }
            else if (string.IsNullOrWhiteSpace(acc.Name) && !string.IsNullOrWhiteSpace(lot.SellingMark))
            {
                acc.Name = lot.SellingMark.Trim();
            }

            var broker = lot.Broker.Trim().ToUpperInvariant();
            acc.QtyByBroker[broker] = acc.QtyByBroker.GetValueOrDefault(broker) + qty;
        }

        var rows = groups.Values
            // Shared = two or more brokers actually carried real (>0) volume of this factory —
            // matches this report's whole purpose; a factory only one broker catalogued isn't a
            // split at all.
            .Where(a => a.QtyByBroker.Count(kv => kv.Value > 0) >= 2)
            .Select(a =>
            {
                var total = a.QtyByBroker.Values.Sum();
                var percentByBroker = a.QtyByBroker.ToDictionary(
                    kv => kv.Key,
                    kv => total > 0 ? Math.Round(kv.Value / total * 100m, 1) : 0m);
                var displayName = a.Name ?? a.Code;
                return new SharedMarkCataloguePercentRowDto(
                    a.Code,
                    System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(displayName.ToLowerInvariant()),
                    a.QtyByBroker,
                    percentByBroker,
                    total);
            })
            // Alphabetical by factory name, per explicit instruction.
            .OrderBy(r => r.FactoryName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var brokers = rows
            .SelectMany(r => r.QtyByBroker.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new SharedMarkCataloguePercentDto(brokers, rows);
    }

    /// <summary>Same fallback chain as SharedMarkCatalogueService.GroupKey: the producing
    /// factory's own code first, then Trade Mark, then raw Selling Mark text as a last resort so
    /// a code-less lot still groups instead of being dropped.</summary>
    private static string? GroupKey(Lot lot) =>
        !string.IsNullOrWhiteSpace(lot.Factory) ? SharedMarkCatalogueService.NormalizeMarkCode(lot.Factory)
        : !string.IsNullOrWhiteSpace(lot.Mark) ? SharedMarkCatalogueService.NormalizeMarkCode(lot.Mark)
        : !string.IsNullOrWhiteSpace(lot.SellingMark) ? lot.SellingMark.Trim()
        : null;

    private sealed class Accumulator
    {
        public string Code { get; set; } = "";
        public string? Name { get; set; }
        public bool NameIsFactoryName { get; set; }
        public Dictionary<string, decimal> QtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
    }
}
