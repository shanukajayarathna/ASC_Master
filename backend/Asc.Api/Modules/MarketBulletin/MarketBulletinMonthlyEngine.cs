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
/// Per sale: the market's own price bands are cut by CUMULATIVE QUANTITY (Kg), per the user's
/// own instruction — every broker's sold lots that sale, sorted by price descending, walked
/// accumulating traded weight until 15/45/85% of the market's total Kg is reached (a 15/30/40/15
/// Select Best/Best/Below Best/Poor split — the same one TierSplitter uses for pages 1-3, both
/// updated together from an earlier 20/35/30/15 split per the user's own instruction); Select
/// Best's threshold is the price where the running total first crosses 15%, Best's at 45%, Below
/// Best's at 85%, Poor's is simply the sale's lowest sold price. This replaced an earlier
/// PRICE-WIDTH version (proportional slices of literal max-to-min price, no quantity involved in
/// where a band started) — see ComputeQuantityWeightedThresholds' own doc comment for why. Both
/// are still deliberately different from TierSplitter's lot-COUNT percentile mechanism (they
/// share the same tier PROPORTIONS, just cut by quantity vs. by lot count): a count-based cut
/// always forces exactly 15% of that sale's lots into Poor by construction regardless of what
/// the market actually did.
///
/// Asia Siyaka's own sold lots (TopPriceEngine.IsOurBroker) are then classified into whichever
/// of that same sale's own price bands each lot's own price actually falls into, and reduced to
/// per-band totals: total quantity (kg) plus the literal min/max price among just ASC's own lots
/// in that band, shown as a range rather than one averaged number — see MonthlyTierMetricsDto's
/// own doc comment for why.
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
        var thresholds = ComputeQuantityWeightedThresholds(marketSold);

        var buckets = new List<Lot>[] { [], [], [], [] };
        foreach (var lot in marketSold.Where(TopPriceEngine.IsOurBroker))
            buckets[ClassifyByMarketThreshold(lot.PurchasedPrice!.Value, thresholds)].Add(lot);

        return TierNames.Select((name, idx) => BuildTierMetrics(name, buckets[idx])).ToList();
    }

    /// <summary>The four Valuation Centre price-band thresholds, cut by cumulative QUANTITY (Kg)
    /// across the whole market that sale, per the user's own instruction — replaces an earlier
    /// price-WIDTH version of this method (proportional slices of literal max-to-min price, with
    /// no quantity involved in deciding where a band starts). Every broker's sold lots that sale
    /// are sorted by price descending, then walked accumulating NetWeight: Select Best's
    /// threshold is the price of the lot at which cumulative quantity first reaches 15% of the
    /// market's total traded Kg, Best's at 45% (15% + a 30%-wide Best band), Below Best's at 85%
    /// (+ a 40%-wide Below Best band), and Poor's own threshold is simply the lowest sold price
    /// (the remaining 15%), so every priced lot matches at least that last check — the same
    /// 15/30/40/15 split TierSplitter uses for pages 1-3, updated together from the original
    /// 20/35/30/15 per the user's own instruction so the two never drift apart. A price band can
    /// be wide or narrow depending on how much quantity actually traded at those prices, not on
    /// how far apart the literal min/max happen to sit — a sale with a handful of very cheap,
    /// very small lots no longer drags Poor's band across most of the price axis the way a
    /// price-width cut could.</summary>
    private static decimal?[] ComputeQuantityWeightedThresholds(List<Lot> lots)
    {
        var priced = lots.Where(l => l.PurchasedPrice.HasValue)
            .OrderByDescending(l => l.PurchasedPrice!.Value)
            .ToList();
        if (priced.Count == 0) return [null, null, null, null];

        var min = priced[^1].PurchasedPrice!.Value;
        var totalQty = priced.Sum(l => l.NetWeight ?? 0m);
        if (totalQty <= 0) return [min, min, min, min];

        decimal cumulative = 0;
        decimal? t15 = null, t45 = null, t85 = null;
        foreach (var lot in priced)
        {
            cumulative += lot.NetWeight ?? 0m;
            var cumulativeFraction = cumulative / totalQty;
            if (t15 is null && cumulativeFraction >= 0.15m) t15 = lot.PurchasedPrice!.Value;
            if (t45 is null && cumulativeFraction >= 0.45m) t45 = lot.PurchasedPrice!.Value;
            if (t85 is null && cumulativeFraction >= 0.85m) t85 = lot.PurchasedPrice!.Value;
        }
        // Guards the same all-zero-quantity edge case as the totalQty<=0 return above, but for
        // individual lots with null/zero weight scattered through an otherwise-fine sale —
        // cumulativeFraction can then legitimately never cross a threshold before the loop ends.
        return [t15 ?? min, t45 ?? min, t85 ?? min, min];
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
        if (tierLots.Count == 0) return new MonthlyTierMetricsDto(tierName, null, null, null, 0);
        var qty = tierLots.Sum(l => l.NetWeight ?? 0m);
        var minPrice = tierLots.Min(l => l.PurchasedPrice!.Value);
        var maxPrice = tierLots.Max(l => l.PurchasedPrice!.Value);
        return new MonthlyTierMetricsDto(tierName, qty, minPrice, maxPrice, tierLots.Count);
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
