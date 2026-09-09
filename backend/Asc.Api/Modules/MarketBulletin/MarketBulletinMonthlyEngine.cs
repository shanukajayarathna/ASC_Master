using System.Text.RegularExpressions;
using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;
using Asc.Api.Services;

namespace Asc.Api.Modules.MarketBulletin;

/// <summary>
/// Month-over-month comparison for the bulletin's own 4th page: for the sale currently being
/// viewed, every sale so far THIS calendar month (up to and including the viewed sale itself —
/// a later sale that already happened in real time but comes after the viewed one in this same
/// month is treated as "hasn't happened yet", matching every other page's own "as of this sale"
/// perspective) lines up against the FULL calendar of LAST month, slot for slot by ordinal
/// position (the 1st sale of this month against the 1st sale of last month, not by matching
/// sale numbers, which reset per year and don't carry month alignment anyway).
///
/// Per sale: the market's own price SPAN (every broker's sold lots that sale — the literal
/// lowest sold price to the literal highest, no trimming) is split into four bands by taking
/// 20/35/30/15 proportional SLICES OF THAT PRICE WIDTH, not a lot-count percentile — Select
/// Best is the top 20% of the sale's own price range that week, Poor the bottom 15%, however
/// many lots actually land in each. This is deliberately different from TierSplitter (what
/// pages 1-3, and an earlier version of this page, use): a lot-count cut always forces ~15% of
/// that sale's lots into Poor by construction, no matter what the market actually did, which
/// meant Poor could never show a real quality swing. Confirmed with the user this price-width
/// method, recalculated fresh per sale (not calibrated from a separate reference period), is the
/// intended one for this page. A 5th-95th percentile trim was tried and reverted per the user's
/// own senior: the literal min/max is what they want, even when a single lot sits at either
/// extreme.
///
/// Asia Siyaka's own sold lots (TopPriceEngine.IsOurBroker) are then classified into whichever
/// of that same sale's own price bands each lot's own price actually falls into, and reduced to
/// two numbers per band: total quantity (kg) and a quantity-weighted average price of just ASC's
/// own lots in that band — see MonthlyTierMetricsDto's own doc comment for why not a plain
/// per-lot average.
/// </summary>
public static class MarketBulletinMonthlyEngine
{
    private static readonly Regex SaleNoInSourceName = new(@"^Sale (\d+) - \d+$", RegexOptions.Compiled);
    private static readonly string[] TierNames = ["Select Best", "Best", "Below Best", "Poor"];

    public static MonthlyComparisonDto? Build(ICatalogueSource source, Catalogue target)
    {
        var match = SaleNoInSourceName.Match(target.SourceName);
        if (!match.Success) return null;
        var targetSaleNo = int.Parse(match.Groups[1].Value);

        // Catalogue.ImportedAt is a REAL file-import timestamp for a bulk-loaded historical year
        // (see MarketBulletinController.PreviousCatalogue's own comment) — worthless as "this
        // sale's real calendar month" for any year older than the current/recent ones
        // SaleFileStore actually has date data for. Confirmed live: a 2024 sale's ImportedAt
        // read as September 2026, simply the day that old file happened to get bulk-imported.
        // Scanning every month of the target's own year via SalesInMonth (the SAME trusted
        // per-year date system every other calendar decision on this page relies on) instead
        // finds which month genuinely contains this sale number, with zero dependency on
        // ImportedAt. A year SaleFileStore has no date table for (2024 and earlier) matches no
        // month for any sale number, and page 4 is skipped entirely (null) rather than silently
        // showing a month that's wrong.
        var resolved = ResolveTargetMonth(source, target.Year, targetSaleNo);
        if (resolved is null) return null;
        var (targetMonth, targetDate) = resolved.Value;

        // SalesInMonth's own weekly-anchor estimate can drift a day or two from the real
        // calendar (see SharedMarkCatalogueService's own AlignCalendarToKnownSaleDate, which
        // this mirrors) — the viewed sale's own date is now known exactly (from the scan above),
        // so every other week in ITS month is shifted by the same constant offset. Last month
        // needs no such correction: it's a different month's own calendar, already computed from
        // its own year's anchor/date table, with nothing exact to calibrate against here.
        //
        // The FULL month's calendar is kept here (not filtered to <= targetSaleNo) — that filter
        // used to strip a later-this-month sale out of the list entirely, which meant viewing an
        // EARLY sale in a 5-sale month only ever showed 1-2 circles instead of the real 5, with
        // no placeholder for the remaining weeks. The "as of this sale" cutoff (a later sale
        // that already happened in real time but comes after the viewed one must still read as
        // "hasn't happened yet") is now enforced per-slot in BuildSlots instead, so those
        // still-to-come sales stay in the list as empty placeholder circles rather than vanishing.
        var thisMonthCalendar = AlignToKnownDate(source.SalesInMonth(target.Year, targetMonth), targetSaleNo, targetDate)
            .OrderBy(w => w.SaleNo)
            .ToList();

        var (lastMonthYear, lastMonth) = targetMonth == 1 ? (target.Year - 1, 12) : (target.Year, targetMonth - 1);
        var lastMonthCalendar = source.SalesInMonth(lastMonthYear, lastMonth).OrderBy(w => w.SaleNo).ToList();

        return new MonthlyComparisonDto(
            ThisMonthLabel: targetDate.ToString("MMMM yyyy"),
            LastMonthLabel: new DateTime(lastMonthYear, lastMonth, 1).ToString("MMMM yyyy"),
            ThisMonth: BuildSlots(source, target.Year, thisMonthCalendar, cutoffSaleNo: targetSaleNo),
            LastMonth: BuildSlots(source, lastMonthYear, lastMonthCalendar, cutoffSaleNo: null));
    }

    private static (int Month, DateTime Date)? ResolveTargetMonth(ICatalogueSource source, int year, int targetSaleNo)
    {
        for (var m = 1; m <= 12; m++)
        {
            var entry = source.SalesInMonth(year, m).FirstOrDefault(w => w.SaleNo == targetSaleNo);
            if (entry != default) return (m, entry.Date);
        }
        return null;
    }

    /// <summary>`cutoffSaleNo` is the sale currently being viewed, for "this month" only (null
    /// for "last month", which is always fully in the past). A calendar slot whose SaleNo is
    /// GREATER than the cutoff hasn't happened yet from this report's own "as of this sale"
    /// perspective, even if it's already been sold in real wall-clock time by the time someone
    /// views this report later — it always renders as an empty placeholder (tiers null), though
    /// its real SourceName is still shown if that sale has already been catalogued (matches the
    /// user's own confirmed behavior: "Sale 35 - 2026" labelled but empty, not a blank "Not
    /// yet").</summary>
    private static List<MonthlySaleSlotDto> BuildSlots(ICatalogueSource source, int year, List<(int SaleNo, DateTime Date)> calendar, int? cutoffSaleNo)
    {
        var slots = new List<MonthlySaleSlotDto>();
        for (var i = 0; i < calendar.Count; i++)
        {
            var saleNo = calendar[i].SaleNo;
            var catalogueId = SaleFileStore.CatalogueIdFor(year, saleNo);
            var catalogue = source.GetCatalogue(catalogueId);

            if (cutoffSaleNo is int cutoff && saleNo > cutoff)
            {
                slots.Add(new MonthlySaleSlotDto(i + 1, catalogue?.SourceName, null));
                continue;
            }

            var lots = catalogue is not null ? source.GetLots(catalogueId) : null;
            if (catalogue is null || lots is null || lots.Count == 0)
            {
                slots.Add(new MonthlySaleSlotDto(i + 1, null, null));
                continue;
            }

            slots.Add(new MonthlySaleSlotDto(i + 1, catalogue.SourceName, BuildTierMetricsForSale(lots)));
        }
        return slots;
    }

    /// <summary>Splits this one sale's own market (every broker's sold lots) into four price
    /// bands by price-WIDTH proportions (see this class's own doc comment), then classifies
    /// Asia Siyaka's own sold lots into whichever of those bands each lot's own price falls
    /// into. A sale where the market has no sold lots at all (thresholds all null) or ASC simply
    /// has no lots comes back as four empty tiers, same shape as a sale with no data at all —
    /// MonthlyTierMetricsDto's LotCount: 0 case, which the frontend already renders as an empty
    /// placeholder.</summary>
    internal static List<MonthlyTierMetricsDto> BuildTierMetricsForSale(IReadOnlyList<Lot> lots)
    {
        var marketSold = TopPriceEngine.ScopeToSold(lots).Sold;
        var thresholds = ComputePriceWidthThresholds(marketSold);

        var buckets = new List<Lot>[] { [], [], [], [] };
        foreach (var lot in marketSold.Where(TopPriceEngine.IsOurBroker))
            buckets[ClassifyByMarketThreshold(lot.PurchasedPrice!.Value, thresholds)].Add(lot);

        return TierNames.Select((name, idx) => BuildTierMetrics(name, buckets[idx])).ToList();
    }

    /// <summary>The four Valuation Centre price-band thresholds as proportional slices of the
    /// market's own price WIDTH that sale — Select Best's threshold is 20% of the way down from
    /// the top of that width, Best's is 55% down, Below Best's is 85% down (equivalently, 15% up
    /// from the bottom), and Poor's own threshold is the bottom of it, so every priced lot
    /// matches at least that last check. Deliberately NOT TierSplitter's lot-count percentile —
    /// see this class's own doc comment for why a price-width slice is what actually lets Poor
    /// grow or shrink with real market quality, unlike a count-based cut which always claims
    /// ~15% of lots regardless of what sold.
    ///
    /// The "top" and "bottom" of that width are the literal highest and lowest sold price that
    /// sale, even when only a single lot sits at either extreme — a 5th-95th percentile trim was
    /// tried (to stop one freak lot from setting the ruler for the whole sale) and reverted once
    /// the user's own senior confirmed the literal range is what they actually want.</summary>
    private static decimal?[] ComputePriceWidthThresholds(List<Lot> lots)
    {
        var priced = lots.Where(l => l.PurchasedPrice.HasValue).Select(l => l.PurchasedPrice!.Value).ToList();
        if (priced.Count == 0) return [null, null, null, null];
        var max = priced.Max();
        var min = priced.Min();
        var span = max - min;
        if (span <= 0) return [max, max, max, min];
        return [max - span * 0.20m, max - span * 0.55m, max - span * 0.85m, min];
    }

    /// <summary>Select Best's threshold checked first, so a price sitting exactly on a shared
    /// boundary resolves toward the higher band — falls through to Poor if every threshold is
    /// null (the sale itself had no sold lots) or the price is below all of them (shouldn't
    /// happen once Poor's own threshold is the market's true minimum, but kept as a safe
    /// default).</summary>
    private static int ClassifyByMarketThreshold(decimal price, decimal?[] thresholds)
    {
        for (var i = 0; i < thresholds.Length; i++)
        {
            if (thresholds[i] is decimal t && price >= t) return i;
        }
        return TierSplitter.Poor;
    }

    private static MonthlyTierMetricsDto BuildTierMetrics(string tierName, List<Lot> tierLots)
    {
        if (tierLots.Count == 0) return new MonthlyTierMetricsDto(tierName, null, null, 0);
        var qty = tierLots.Sum(l => l.NetWeight ?? 0m);
        var value = tierLots.Sum(l => (l.NetWeight ?? 0m) * l.PurchasedPrice!.Value);
        var avgPrice = qty > 0 ? value / qty : tierLots.Average(l => l.PurchasedPrice!.Value);
        return new MonthlyTierMetricsDto(tierName, qty, Math.Round(avgPrice), tierLots.Count);
    }

    private static IReadOnlyList<(int SaleNo, DateTime Date)> AlignToKnownDate(
        IReadOnlyList<(int SaleNo, DateTime Date)> calendar, int knownSaleNo, DateTime knownDate)
    {
        var known = calendar.FirstOrDefault(w => w.SaleNo == knownSaleNo);
        if (known == default) return calendar;
        var offset = knownDate.Date - known.Date.Date;
        return offset == TimeSpan.Zero ? calendar : calendar.Select(w => (w.SaleNo, w.Date + offset)).ToList();
    }
}
