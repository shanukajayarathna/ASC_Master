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
/// sale numbers, which reset per year and don't carry month alignment anyway). Each sale's own
/// catalogue lots are first scoped to Asia Siyaka's own broker code (TopPriceEngine.OurBroker,
/// "ASC") before anything else — a single imported catalogue carries every broker's lots for
/// that sale (needed elsewhere for e.g. TopPriceEngine's cross-broker ranking), but this page is
/// deliberately ASC's own book, not a market-wide snapshot like pages 1-3's per-grade tables
/// (which replicate the OFFICIAL printed bulletin and must stay market-wide). Confirmed with the
/// user: "asc broker only which is us." The ASC-only, sold lots are then split into the same four
/// Valuation Centre tiers via TierSplitter and reduced to two numbers per tier: total quantity
/// (kg) and a quantity-weighted average price — see MonthlyTierMetricsDto's own doc comment for
/// why not a plain per-lot average.
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
        var thisMonthCalendar = AlignToKnownDate(source.SalesInMonth(target.Year, targetMonth), targetSaleNo, targetDate)
            .Where(w => w.SaleNo <= targetSaleNo)
            .OrderBy(w => w.SaleNo)
            .ToList();

        var (lastMonthYear, lastMonth) = targetMonth == 1 ? (target.Year - 1, 12) : (target.Year, targetMonth - 1);
        var lastMonthCalendar = source.SalesInMonth(lastMonthYear, lastMonth).OrderBy(w => w.SaleNo).ToList();

        return new MonthlyComparisonDto(
            ThisMonthLabel: targetDate.ToString("MMMM yyyy"),
            LastMonthLabel: new DateTime(lastMonthYear, lastMonth, 1).ToString("MMMM yyyy"),
            ThisMonth: BuildSlots(source, target.Year, thisMonthCalendar),
            LastMonth: BuildSlots(source, lastMonthYear, lastMonthCalendar));
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

    private static List<MonthlySaleSlotDto> BuildSlots(ICatalogueSource source, int year, List<(int SaleNo, DateTime Date)> calendar)
    {
        var slots = new List<MonthlySaleSlotDto>();
        for (var i = 0; i < calendar.Count; i++)
        {
            var catalogueId = SaleFileStore.CatalogueIdFor(year, calendar[i].SaleNo);
            var catalogue = source.GetCatalogue(catalogueId);
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

    /// <summary>Asia Siyaka's own sold lots for one sale, split into the four Valuation Centre
    /// tiers — see this class's own doc comment for why ASC-only rather than every broker in the
    /// catalogue. A sale where ASC simply has no lots (or none sold) comes back as four empty
    /// tiers, same shape as a sale with no data at all — MonthlyTierMetricsDto's LotCount: 0 case,
    /// which the frontend already renders as an empty placeholder.</summary>
    internal static List<MonthlyTierMetricsDto> BuildTierMetricsForSale(IReadOnlyList<Lot> lots)
    {
        var ours = lots.Where(TopPriceEngine.IsOurBroker);
        var sold = TopPriceEngine.ScopeToSold(ours).Sold;
        var slices = TierSplitter.SliceFourTiers(sold);
        return TierNames.Select((name, idx) => BuildTierMetrics(name, slices[idx])).ToList();
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
