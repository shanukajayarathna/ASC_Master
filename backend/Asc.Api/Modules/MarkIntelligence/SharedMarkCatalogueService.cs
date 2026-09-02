using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>One Selling Mark's catalogued quantity for one sale, plus month-to-date/
/// year-to-date running totals, broken down per broker.</summary>
public record SharedMarkCatalogueRow(
    string EstateName,
    string ElevationBucket, // "Low Grown" or "High & Medium Grown"
    IReadOnlyDictionary<string, decimal> SaleQtyByBroker,
    IReadOnlyDictionary<string, decimal> MonthQtyByBroker,
    IReadOnlyDictionary<string, decimal> YearQtyByBroker);

public record SharedMarkCatalogueResult(int SaleYear, int SaleNo, DateTime SaleDate, IReadOnlyList<SharedMarkCatalogueRow> Rows);

/// <summary>
/// Reproduces the user's hand-built "Sharing Mark Catalogued Summary" — for every Selling
/// Mark ASC shares with another Colombo broker, how much each side catalogued this sale,
/// this month, and this year, split by elevation. Reverse-engineered against real Sale
/// 36/2026 output; see docs/29_Mark_Intelligence.md and this module's own doc comments for
/// the underlying Plantation/Factory/Mark hierarchy this sits alongside.
///
/// Deliberately reads /data/sales (ICatalogueSource), not the Msl archive (AuctionLot):
/// data/sales/{year}/{sale}.xlsx's "General Report" sheet is a single consolidated,
/// all-broker file (ASC + every other Colombo broker in one sheet) and carries the "RP"
/// (reprint) column the archive doesn't have at all.
///
/// Grouping is by exact Selling Mark text alone — deliberately NOT by a shared base
/// Trade Mark/Factory code. An earlier version merged Selling Marks sharing a base code
/// (e.g. "MF1044"/"MF1044A") on the theory that a trailing letter marks a sibling brand of
/// the same estate — true for some pairs (Green Mount / Green Mount Super) but false for
/// others found in real Sale 36 data: Greenwood/Midfield, Udahentenne/Shemrock, Tinioya/
/// Maratenne, Sithaka/Avissawella and Garden Leaf/Misa Tea are all genuinely unrelated
/// estates that happen to share a code block — merging them silently hid real shared marks
/// (Avissawella, Misa Tea, Greenwood, Maratenne, Udahentenne) under a wrong neighbor's
/// name. There is no way to tell a true sibling-brand pair from a coincidental code-block
/// neighbor from the code alone, so per explicit instruction this never merges — every
/// Selling Mark is always its own row, even when it's known to be the same physical estate
/// as another (e.g. Boscombe/Kinkini).
/// </summary>
public class SharedMarkCatalogueService(ICatalogueSource catalogues)
{
    // The literal broker code /data/sales uses for ASC's own rows in this consolidated
    // general report (confirmed against real Sale 36/2026 data) — NOT "AS", which is the
    // Msl archive's broker code and what MarkAscActivityCheckService expects from an
    // ASC-only file. This file carries every broker's rows together, spelled "ASC".
    private const string AscBrokerCode = "ASC";

    public Task<SharedMarkCatalogueResult> AggregateAsync(int year, int saleNo, CancellationToken ct)
    {
        var targetId = SaleFileStore.CatalogueIdFor(year, saleNo);
        var targetCatalogue = catalogues.GetCatalogue(targetId)
            ?? throw new InvalidOperationException($"No sale file found for sale {saleNo}/{year}.");
        var saleDate = targetCatalogue.ImportedAt;

        // Every sale so far this calendar year (drives YTD); the subset also in this
        // calendar month drives MTD. Both windows are inclusive of the target sale itself.
        var yearCatalogues = catalogues.ListCatalogues()
            .Where(c => c.Year == year && c.ImportedAt.Date <= saleDate.Date)
            .ToList();
        var monthCatalogueIds = yearCatalogues
            .Where(c => c.ImportedAt.Month == saleDate.Month)
            .Select(c => c.Id)
            .ToHashSet();

        var taggedLots = yearCatalogues.SelectMany(cat =>
        {
            var lots = catalogues.GetLots(cat.Id) ?? [];
            var isTargetSale = cat.Id == targetId;
            var isThisMonth = monthCatalogueIds.Contains(cat.Id);
            return lots.Select(lot => (Lot: lot, IsTargetSale: isTargetSale, IsThisMonth: isThisMonth));
        });

        var rows = BuildRows(taggedLots);
        return Task.FromResult(new SharedMarkCatalogueResult(year, saleNo, saleDate, rows));
    }

    /// <summary>
    /// Generates the report for a sale that hasn't happened yet, from raw per-broker
    /// pre-sale catalogue files (BrokerCatalogueUploadParser) rather than /data/sales,
    /// which won't have this sale's file until well after it closes (see this class's own
    /// doc comment). MTD/YTD history still comes from /data/sales' already-closed sales
    /// this year; the uploaded lots stand in for the not-yet-existing target sale.
    ///
    /// None of the raw broker files carry an elevation column (only /data/sales' enriched
    /// General Report does), so elevation is backfilled from whichever closed sale this
    /// year already has the exact same SellingMark — elevation is a fixed physical property
    /// of the estate, so this is exact wherever a match exists. A mark with no match this
    /// year falls back to the "High & Medium Grown" bucket by default (BuildRows' own
    /// null-elevation behavior).
    /// </summary>
    public Task<SharedMarkCatalogueResult> AggregateFromUploadAsync(
        int year, int saleNo, DateTime saleDate, IReadOnlyList<Lot> uploadedLots, CancellationToken ct)
    {
        var historicalCatalogues = catalogues.ListCatalogues()
            .Where(c => c.Year == year && c.ImportedAt.Date < saleDate.Date)
            .ToList();
        var monthCatalogueIds = historicalCatalogues
            .Where(c => c.ImportedAt.Month == saleDate.Month)
            .Select(c => c.Id)
            .ToHashSet();

        var historicalTagged = historicalCatalogues
            .SelectMany(cat =>
            {
                var lots = catalogues.GetLots(cat.Id) ?? [];
                var isThisMonth = monthCatalogueIds.Contains(cat.Id);
                return lots.Select(lot => (Lot: lot, IsTargetSale: false, IsThisMonth: isThisMonth));
            })
            .ToList();

        var elevationBySellingMark = historicalTagged
            .Select(t => t.Lot)
            .Where(l => !string.IsNullOrWhiteSpace(l.SellingMark) && !string.IsNullOrWhiteSpace(l.Elevation))
            .GroupBy(l => l.SellingMark!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Elevation, StringComparer.OrdinalIgnoreCase);

        foreach (var lot in uploadedLots)
            if (lot.SellingMark is not null && elevationBySellingMark.TryGetValue(lot.SellingMark, out var elevation))
                lot.Elevation = elevation;

        var taggedLots = historicalTagged
            .Concat(uploadedLots.Select(lot => (Lot: lot, IsTargetSale: true, IsThisMonth: true)));

        var rows = BuildRows(taggedLots);
        return Task.FromResult(new SharedMarkCatalogueResult(year, saleNo, saleDate, rows));
    }

    /// <summary>Pure grouping/aggregation core — no I/O, fully unit-testable. Groups
    /// non-reprint lots by exact Selling Mark text (never merged across marks — see this
    /// class's own doc comment for why), sums NetWeight per broker into sale/month/year
    /// buckets per the tags each lot carries, and keeps only marks with both ASC and at
    /// least one other broker present.</summary>
    public static IReadOnlyList<SharedMarkCatalogueRow> BuildRows(
        IEnumerable<(Lot Lot, bool IsTargetSale, bool IsThisMonth)> taggedLots)
    {
        var groups = new Dictionary<string, GroupAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var (lot, isTargetSale, isThisMonth) in taggedLots)
        {
            if (lot.IsReprint) continue;
            if (string.IsNullOrWhiteSpace(lot.SellingMark)) continue;
            if (lot.NetWeight is not { } qty || qty <= 0) continue;
            var broker = string.IsNullOrWhiteSpace(lot.Broker) ? "(unknown)" : lot.Broker.Trim().ToUpperInvariant();

            var key = lot.SellingMark.Trim();
            if (!groups.TryGetValue(key, out var acc))
                groups[key] = acc = new GroupAccumulator();

            acc.Elevation ??= lot.Elevation;
            acc.Brokers.Add(broker);
            Add(acc.YearQtyByBroker, broker, qty);
            if (isThisMonth) Add(acc.MonthQtyByBroker, broker, qty);
            if (isTargetSale) Add(acc.SaleQtyByBroker, broker, qty);
        }

        return groups
            .Where(kv => kv.Value.Brokers.Contains(AscBrokerCode) && kv.Value.Brokers.Any(b => b != AscBrokerCode))
            .Select(kv => new SharedMarkCatalogueRow(
                EstateName: System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(kv.Key.ToLowerInvariant()),
                ElevationBucket: string.Equals(kv.Value.Elevation?.Trim(), "L", StringComparison.OrdinalIgnoreCase)
                    ? "Low Grown" : "High & Medium Grown",
                SaleQtyByBroker: kv.Value.SaleQtyByBroker,
                MonthQtyByBroker: kv.Value.MonthQtyByBroker,
                YearQtyByBroker: kv.Value.YearQtyByBroker))
            .OrderBy(r => r.EstateName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private sealed class GroupAccumulator
    {
        public HashSet<string> Brokers { get; } = new(StringComparer.OrdinalIgnoreCase);
        public string? Elevation { get; set; }
        public Dictionary<string, decimal> SaleQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> MonthQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> YearQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private static void Add(Dictionary<string, decimal> map, string broker, decimal qty) =>
        map[broker] = map.GetValueOrDefault(broker) + qty;
}
