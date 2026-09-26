using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;

namespace Asc.Api.Modules.CategoryAverageTrend;

public sealed record TrendSaleLots(int SaleNo, int SaleYear, IReadOnlyList<Lot> Lots);

/// <summary>
/// Sale-by-sale average price per grade within a fixed set of catalogue categories, with the change
/// against the previous sale — the "Low Grown, Off Grade &amp; Dust" trend report.
///
/// Average = total proceeds / total quantity, over Sold AND Outsold lots (an outsold lot is a lot
/// sold after the auction proper, so it has a price and belongs in the average; Unsold lots have
/// neither and are left out). Quantity is the lot's total weight (Lot.NetWeight, imported from the
/// "Total Weight" column) and proceeds are that weight x the lot's FINAL price — the sale file's
/// "Final Price" column, which is what "Total Value" is built from. Purchased Price is only the
/// fallback: for an outsold lot it can be the first-round bid, and the two differ on a few hundred
/// lots in some sales, so using it would not reproduce the worksheet's total proceeds. This is the
/// same weighted average the manual worksheet uses, never an average of lot prices.
///
/// The four low grown categories only count Sub Elevation "L" lots; Off Grade and Dust count every
/// elevation, because those categories are not tied to a growing region.
/// </summary>
public static class CategoryAverageTrendEngine
{
    /// <summary>How many sales the report shows. One earlier sale is read on top of these purely so the
    /// oldest shown sale still has something to be compared with.</summary>
    public const int ShownSales = 5;

    private const string LowGrownElevation = "L";

    public sealed record CategorySpec(string Name, bool LowGrownOnly);

    public static readonly IReadOnlyList<CategorySpec> Categories =
    [
        new("Leafy", true),
        new("Semi Leafy", true),
        new("Tippy", true),
        new("Premium Flowery", true),
        new("Off Grade", false),
        new("Dust", false),
    ];

    private static string NormalizeKey(string? value) =>
        new([.. (value ?? string.Empty).ToLowerInvariant().Where(char.IsLetterOrDigit)]);

    public static bool IsSoldOrOutsold(Lot lot) => TopPriceEngine.IsSold(lot) || TopPriceEngine.IsOutsold(lot);

    /// <summary>The price the lot finally sold at (Rs/kg): the file's "Final Price", else Purchased Price.</summary>
    internal static decimal FinalPrice(Lot lot) =>
        lot.RawData.TryGetValue("Final Price", out var raw) && decimal.TryParse(raw?.Replace(",", ""), out var final) && final > 0
            ? final
            : lot.PurchasedPrice ?? 0;

    private sealed class Acc
    {
        public decimal Qty;
        public decimal Proceeds;
    }

    /// <summary>Per sale: (category index, upper-cased grade or null for the category total) -> totals.</summary>
    private static Dictionary<(int Category, string? Grade), Acc> Aggregate(
        IEnumerable<Lot> lots, string? broker, Dictionary<(int, string), string> gradeLabels)
    {
        var totals = new Dictionary<(int, string?), Acc>();
        var categoryKeys = Categories.Select(c => NormalizeKey(c.Name)).ToArray();

        foreach (var lot in lots)
        {
            if (!IsSoldOrOutsold(lot)) continue;
            if (broker is not null && !string.Equals(lot.Broker?.Trim(), broker, StringComparison.OrdinalIgnoreCase)) continue;

            var qty = lot.NetWeight ?? 0;
            var price = FinalPrice(lot);
            if (qty <= 0 || price <= 0) continue;

            var categoryKey = NormalizeKey(lot.Category);
            var ci = Array.IndexOf(categoryKeys, categoryKey);
            if (ci < 0) continue;
            if (Categories[ci].LowGrownOnly &&
                !string.Equals(lot.Elevation?.Trim(), LowGrownElevation, StringComparison.OrdinalIgnoreCase)) continue;

            var grade = lot.Grade?.Trim();
            if (string.IsNullOrEmpty(grade)) grade = "(no grade)";
            var gradeKey = grade.ToUpperInvariant();
            gradeLabels.TryAdd((ci, gradeKey), grade);

            foreach (var key in new[] { (ci, (string?)null), (ci, gradeKey) })
            {
                if (!totals.TryGetValue(key, out var acc)) totals[key] = acc = new Acc();
                acc.Qty += qty;
                acc.Proceeds += qty * price;
            }
        }
        return totals;
    }

    private static decimal? AverageOf(Dictionary<(int, string?), Acc> sale, (int, string?) key) =>
        sale.TryGetValue(key, out var a) && a.Qty > 0 ? Math.Round(a.Proceeds / a.Qty, 2) : null;

    /// <param name="salesOldestFirst">Every sale that may take part, oldest first. The newest
    /// <see cref="ShownSales"/> are shown; the one before them (if any) is only a comparison base.</param>
    /// <param name="broker">Broker code to narrow to, or null for every broker.</param>
    public static CategoryAverageTrendDto Build(IReadOnlyList<TrendSaleLots> salesOldestFirst, string? broker)
    {
        var shownCount = Math.Min(ShownSales, salesOldestFirst.Count);
        var shown = salesOldestFirst.Skip(salesOldestFirst.Count - shownCount).ToList();
        var baseSale = salesOldestFirst.Count > shownCount ? salesOldestFirst[salesOldestFirst.Count - shownCount - 1] : null;
        var selected = shown.Count > 0 ? shown[^1] : null;

        var brokers = (selected?.Lots ?? [])
            .Select(l => l.Broker?.Trim())
            .Where(b => !string.IsNullOrEmpty(b))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(b => b, StringComparer.OrdinalIgnoreCase)
            .Select(b => b!)
            .ToList();

        var gradeLabels = new Dictionary<(int, string), string>();
        var perSale = new List<Dictionary<(int, string?), Acc>>();
        if (baseSale is not null) perSale.Add(Aggregate(baseSale.Lots, broker, gradeLabels));
        foreach (var s in shown) perSale.Add(Aggregate(s.Lots, broker, gradeLabels));
        var offset = baseSale is not null ? 1 : 0; // perSale[offset + i] belongs to shown[i]

        List<TrendCellDto> CellsFor((int, string?) key)
        {
            var cells = new List<TrendCellDto>();
            for (var i = 0; i < shown.Count; i++)
            {
                var avg = AverageOf(perSale[offset + i], key);
                // Change is the difference of the two averages exactly as printed, so it can be
                // checked with a calculator against the neighbouring cells.
                var prev = offset + i - 1 >= 0 ? AverageOf(perSale[offset + i - 1], key) : null;
                cells.Add(new TrendCellDto(avg, avg is not null && prev is not null ? avg - prev : null));
            }
            return cells;
        }

        var categories = new List<TrendCategoryDto>();
        for (var ci = 0; ci < Categories.Count; ci++)
        {
            // Grades listed biggest first, by quantity over everything shown, so the ones that
            // matter sit at the top and the order doesn't jump between sales.
            var grades = gradeLabels.Keys.Where(k => k.Item1 == ci).Select(k => k.Item2)
                .OrderByDescending(g => shown.Select((_, i) => perSale[offset + i]).Sum(t => t.TryGetValue((ci, g), out var a) ? a.Qty : 0))
                .ThenBy(g => g, StringComparer.Ordinal)
                .Select(g => new TrendGradeRowDto(gradeLabels[(ci, g)], CellsFor((ci, g))))
                .ToList();
            categories.Add(new TrendCategoryDto(Categories[ci].Name, Categories[ci].LowGrownOnly, CellsFor((ci, null)), grades));
        }

        var hasResults = perSale.Skip(offset).Any(t => t.Count > 0);
        static string Label(TrendSaleLots s) => $"Sale {s.SaleNo}/{s.SaleYear}";
        return new CategoryAverageTrendDto(
            selected is null ? string.Empty : Label(selected),
            [.. shown.Select(s => new TrendSaleDto(s.SaleNo, s.SaleYear, Label(s)))],
            baseSale is null ? null : Label(baseSale),
            broker,
            brokers,
            hasResults,
            categories);
    }
}
