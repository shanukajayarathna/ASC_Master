using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>One Selling Mark's catalogued quantity per sale this month (keyed by sale
/// number, per broker), plus month-to-date/year-to-date running totals. Code is the row's
/// Trade Mark/Factory code (whichever code was first seen for this mark, pre-reconciliation
/// — see BuildRows) — the report's own row order sorts by this, not by EstateName, per
/// explicit instruction.</summary>
public record SharedMarkCatalogueRow(
    string EstateName,
    string Code,
    string ElevationBucket, // "Low Grown" or "High & Medium Grown"
    IReadOnlyDictionary<string, IReadOnlyDictionary<int, decimal>> SaleQtyByBrokerAndSaleNo,
    IReadOnlyDictionary<string, decimal> MonthQtyByBroker,
    IReadOnlyDictionary<string, decimal> YearQtyByBroker);

/// <summary>MonthCalendar is every sale number in the display month, ascending, including
/// ones with no data yet (future weeks) — the report lays out one column per week of the
/// month regardless of whether that week has happened, matching the original hand-built
/// report's fixed weekly-column layout. UnmatchedMarks lists the estate names (as shown in
/// the output) whose code had no elevation history anywhere on file — always empty for
/// AggregateAsync (its lots already carry real elevation, nothing to look up), populated by
/// AggregateFromUploadAsync for marks defaulted to "High & Medium Grown" with no way to
/// confirm that's actually correct.</summary>
public record SharedMarkCatalogueResult(
    int SaleYear, int SaleNo, DateTime SaleDate,
    IReadOnlyList<(int SaleNo, DateTime Date)> MonthCalendar,
    IReadOnlyList<SharedMarkCatalogueRow> Rows,
    IReadOnlyList<string> UnmatchedMarks);

/// <summary>
/// Reproduces the user's hand-built "Sharing Mark Catalogued Summary" — for every Selling
/// Mark ASC shares with another Colombo broker, how much each side catalogued each sale
/// this month (one column per week), this month to date, and this year to date, split by
/// elevation. Reverse-engineered against real Sale 36/2026 output; see
/// docs/29_Mark_Intelligence.md and this module's own doc comments for the underlying
/// Plantation/Factory/Mark hierarchy this sits alongside.
///
/// Deliberately reads /data/sales (ICatalogueSource), not the Msl archive (AuctionLot):
/// data/sales/{year}/{sale}.xlsx's "General Report" sheet is a single consolidated,
/// all-broker file (ASC + every other Colombo broker in one sheet) and carries the "RP"
/// (reprint) column the archive doesn't have at all.
///
/// Grouping is by the full Trade Mark/Factory code (Lot.Mark) as each broker's own file
/// prints it — trailing letter and all — not by the free-text Selling Mark, and not by a
/// letter-stripped/normalized code either. This was tried both ways against real data;
/// here's the full history, since it keeps coming back:
///  - Full code, never merge across codes (the original design). Fixes free-text spelling
///    drift (confirmed live: "MISA"/"MISA TEA" and "NEW PANILKANDA"/"NEW PANILKANDE" share
///    one exact code) without ever combining unrelated estates.
///  - Base factory number, trailing letter stripped, merge every sub-mark of the same
///    number into one row — tried per explicit instruction (confirmed live: "WATADENIYA" is
///    BF0020, "RANSIRINI" is BF0020A, genuinely the same factory). Reverted after checking
///    against a real hand-built reference for Sale 37/2026 turned up three *different*
///    correct behaviors for three different same-base-number families in the same
///    dataset — not one rule: Watadeniya+Ransirini fully merge with no label; Danawala +
///    Danawala Ctc render as two separately labeled Orthodox/CTC sub-blocks, never summed;
///    Liverpool renders alone and Liverpool Super (a plain sibling with no CTC involved at
///    all) doesn't appear anywhere, merged or separate. No signal in the raw data — not the
///    code, not CTC-in-the-name, not the grade — predicts which of the three applies to a
///    given factory; it takes knowing the specific estates. Per explicit instruction this
///    is shelved for now rather than guessed at, so back to the original design: full code,
///    never merged, until there's a reliable per-factory mapping to drive it.
///  - A code with no /data/sales history anywhere on file (a mark that's never sold under
///    it before) falls back to whatever Selling Mark text its own lots carry, since there's
///    nothing to canonicalize against — see AggregateFromUploadAsync's own doc comment.
///  - A broker's own file can simply have the wrong code for an otherwise-correctly-spelled
///    mark (confirmed live: CT's file catalogued "Alagalla" under a code no one else uses —
///    a different letter PREFIX entirely, not just a different trailing letter — while its
///    ~2000 other lots that sale all used ordinary codes; a data-entry error, not a scheme).
///    BuildRows' own reconciliation pass folds any two groups that land on the exact same
///    final display name back into one row regardless of code — a shared estate name is as
///    strong a "same estate" signal as a shared code, and this one is safe to keep: it never
///    triggers for two genuinely different names (Green Mount vs Green Mount Super stay
///    separate), only for an outright code mismatch on the identical name.
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
        var monthCalendar = AlignCalendarToKnownSaleDate(catalogues.SalesInMonth(year, saleDate.Month), saleNo, saleDate);

        // Every sale so far this calendar year (drives YTD); the subset also in this
        // calendar month drives MTD/the weekly columns. Both windows are inclusive of the
        // target sale itself.
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
            var isThisMonth = monthCatalogueIds.Contains(cat.Id);
            return lots.Select(lot => (Lot: lot, IsThisMonth: isThisMonth));
        });

        var rows = BuildRows(taggedLots);
        return Task.FromResult(new SharedMarkCatalogueResult(year, saleNo, saleDate, monthCalendar, rows, []));
    }

    /// <summary>
    /// Generates the report for a sale that hasn't happened yet, from raw per-broker
    /// pre-sale catalogue files (BrokerCatalogueUploadParser) rather than /data/sales,
    /// which won't have this sale's file until well after it closes (see this class's own
    /// doc comment). MTD/YTD history still comes from /data/sales' already-closed sales
    /// this year; the uploaded lots stand in for the not-yet-existing target sale (callers
    /// must stamp each uploaded Lot.SaleNo = saleNo themselves — BrokerCatalogueUploadParser
    /// does this since two of the eight raw files carry no sale-number column at all).
    ///
    /// None of the raw broker files carry an elevation column (only /data/sales' enriched
    /// General Report does) or necessarily agree on how to spell a mark's name, so both are
    /// canonicalized off the one thing every file does carry: the Trade Mark/Factory code —
    /// the full code (NormalizeMarkCode), not a letter-stripped base number — see this
    /// class's own doc comment for why. Each uploaded lot's code is looked up against
    /// whichever closed sale — any year on file, not just this one — already has that exact
    /// code, and both its canonical Selling Mark spelling and its non-blank Sub Elevation
    /// are copied onto the uploaded lot, overwriting whatever spelling the
    /// broker's own file used. A code with no match in any year on file keeps the uploaded
    /// lot's own spelling (nothing to canonicalize against) and falls back to the "High &
    /// Medium Grown" bucket by default (BuildRows' own null-elevation behavior) — the one
    /// case this can't get right, since there's nothing to look up.
    /// </summary>
    public Task<SharedMarkCatalogueResult> AggregateFromUploadAsync(
        int year, int saleNo, DateTime saleDate, IReadOnlyList<Lot> uploadedLots, CancellationToken ct)
    {
        var monthCalendar = AlignCalendarToKnownSaleDate(catalogues.SalesInMonth(year, saleDate.Month), saleNo, saleDate);

        // Excluded by identity (CatalogueIdFor), not just by date: /data/sales' own
        // ImportedAt is itself an estimate for years with no explicit date table (see
        // AlignCalendarToKnownSaleDate) and can land a day either side of the real date —
        // found live, this let the target sale's own already-existing /data/sales file
        // (dated one day "before" the upload's real date by the estimate) slip through the
        // date-only filter and get counted as "historical" on top of the uploaded lots for
        // the exact same sale, doubling every mark's numbers.
        var targetId = SaleFileStore.CatalogueIdFor(year, saleNo);
        var historicalCatalogues = catalogues.ListCatalogues()
            .Where(c => c.Year == year && c.Id != targetId && c.ImportedAt.Date < saleDate.Date)
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
                return lots.Select(lot => (Lot: lot, IsThisMonth: isThisMonth));
            })
            .ToList();

        // First pass: whichever closed sale this year already has the exact same code. Free
        // — historicalTagged is already loaded for MTD/YTD, so this costs no extra catalogue
        // reads.
        var markInfoByCode = BuildMarkInfoIndex(historicalTagged.Select(t => t.Lot));
        ApplyMarkInfo(uploadedLots, markInfoByCode);

        // Second pass, only for codes this year's data couldn't resolve: a mark's estate and
        // elevation don't change with the season, and plenty of marks (confirmed live:
        // Evergreen, Lions/MF-code for "Lions Tea Factory", New Panilkanda, Wewelkandura,
        // Renukanda Ctc) simply haven't sold yet this year under their code. Rather than
        // scanning prior-year catalogues here directly — SaleFileStore deliberately keeps
        // only its 4 most-recently touched sales in memory (MaxLoadedSales), so a raw
        // multi-year scan on every single generation thrashed that cache badly (found live:
        // 30+ minutes for one report) — this defers to SaleFileStore.GetMarkCodeIndex(),
        // which builds the same cross-year code index once and persists it to disk, so every
        // call after the first (across ALL future report generations, not just this one) is
        // a dictionary lookup instead of a fresh scan.
        var stillMissing = uploadedLots.Any(l => string.IsNullOrWhiteSpace(l.Elevation));
        if (stillMissing)
        {
            foreach (var (code, info) in catalogues.GetMarkCodeIndex())
                markInfoByCode.TryAdd(code, info);
            ApplyMarkInfo(uploadedLots, markInfoByCode);
        }

        var taggedLots = historicalTagged
            .Concat(uploadedLots.Select(lot => (Lot: lot, IsThisMonth: true)))
            .ToList();

        var rows = BuildRows(taggedLots);

        // A mark is genuinely unmatched only if NOTHING feeding this report — uploaded or
        // historical, any broker — carries a non-blank elevation under its exact display
        // name. Matching on name here (the same signal BuildRows' own reconciliation pass
        // uses to fold a mismatched code back into the right row) rather than on code keeps
        // this consistent with what actually ends up on screen: checking per-code would
        // over-flag a mark like "Alagalla" whenever any one broker's file uses a different
        // code for it (confirmed live: CT's file catalogued Alagalla under a code no one
        // else uses) even though the row's bucket is already confirmed via the other
        // brokers' matching codes — a false alarm about something that isn't actually in
        // doubt.
        var namesWithConfirmedElevation = taggedLots
            .Select(t => t.Lot)
            .Where(l => !string.IsNullOrWhiteSpace(l.Elevation) && !string.IsNullOrWhiteSpace(l.SellingMark))
            .Select(l => System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(l.SellingMark!.Trim().ToLowerInvariant()))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Only marks that actually made it into the report — one with no ASC+other-broker
        // share this month never renders anywhere, so flagging it would be noise about
        // something the user can't even see.
        var unmatchedMarks = rows
            .Where(r => !namesWithConfirmedElevation.Contains(r.EstateName))
            .Select(r => r.EstateName)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult(new SharedMarkCatalogueResult(year, saleNo, saleDate, monthCalendar, rows, unmatchedMarks));
    }

    private static void ApplyMarkInfo(IReadOnlyList<Lot> lots, Dictionary<string, (string Name, string Elevation)> markInfoByCode)
    {
        foreach (var lot in lots)
        {
            if (!string.IsNullOrWhiteSpace(lot.Elevation)) continue; // already resolved
            var key = GroupKey(lot);
            if (key is not null && markInfoByCode.TryGetValue(key, out var info))
            {
                lot.SellingMark = info.Name;
                lot.Elevation = info.Elevation;
            }
        }
    }

    /// <summary>Pure grouping/aggregation core — no I/O, fully unit-testable. Groups
    /// non-reprint lots by GroupKey (the full Trade Mark/Factory code, never merged across
    /// codes — see this class's own doc comment for why), sums NetWeight per broker into
    /// per-sale-number/month/year buckets, and keeps only marks with both ASC and at least
    /// one other broker present. Each lot's own Lot.SaleNo (stamped by SaleFileStore for
    /// /data/sales lots, or by BrokerCatalogueUploadParser for
    /// uploaded ones) is what buckets it into a weekly column — no separate "is this the
    /// target sale" flag needed.</summary>
    public static IReadOnlyList<SharedMarkCatalogueRow> BuildRows(
        IEnumerable<(Lot Lot, bool IsThisMonth)> taggedLots)
    {
        var groups = new Dictionary<string, GroupAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var (lot, isThisMonth) in taggedLots)
        {
            if (lot.IsReprint) continue;
            if (string.IsNullOrWhiteSpace(lot.SellingMark)) continue;
            if (lot.NetWeight is not { } qty || qty <= 0) continue;
            var broker = string.IsNullOrWhiteSpace(lot.Broker) ? "(unknown)" : lot.Broker.Trim().ToUpperInvariant();

            var key = GroupKey(lot)!;
            if (!groups.TryGetValue(key, out var acc))
                groups[key] = acc = new GroupAccumulator();

            // Only ever lock in a non-blank name/elevation, and only once each. Real
            // /data/sales rows for the same code are inconsistent about carrying a Sub
            // Elevation value at all — plenty of lots (confirmed live: Alagalla, Allen
            // Valley, New Rasagalla, Kamarangapitiya, Palmgarden among others) have it blank
            // on some weeks and "L" on others. The old `??=` treated a blank string as
            // "already has a value" (blank isn't null), so if a blank-elevation lot for a
            // mark happened to be enumerated before a lot carrying the real code, the mark
            // got stuck on blank forever and silently fell into the "High & Medium Grown"
            // default bucket — a real Low Grown estate misclassified for no reason other
            // than lot ordering. The same first-non-blank-wins rule picks the display name
            // when a code's own lots disagree on spelling (confirmed live: "MISA"/"MISA
            // TEA" share one code) — whichever spelling is seen first for a code wins,
            // consistently, rather than splitting the code's volume across two row labels.
            if (string.IsNullOrWhiteSpace(acc.Elevation) && !string.IsNullOrWhiteSpace(lot.Elevation))
                acc.Elevation = lot.Elevation;
            if (string.IsNullOrWhiteSpace(acc.EstateName))
                acc.EstateName = lot.SellingMark.Trim();
            acc.Code ??= key;
            acc.Brokers.Add(broker);
            Add(acc.YearQtyByBroker, broker, qty);
            if (isThisMonth)
            {
                Add(acc.MonthQtyByBroker, broker, qty);
                if (int.TryParse(lot.SaleNo, out var saleNo))
                {
                    if (!acc.SaleQtyByBrokerAndSaleNo.TryGetValue(broker, out var perSale))
                        acc.SaleQtyByBrokerAndSaleNo[broker] = perSale = new Dictionary<int, decimal>();
                    perSale[saleNo] = perSale.GetValueOrDefault(saleNo) + qty;
                }
            }
        }

        // Reconciliation pass: two different codes that end up with the exact same final
        // display name are folded into one row. Found live: Sale 36/2026's CT file catalogued
        // "ALAGALLA" under "SS0634" while every other broker (and /data/sales) used "MF0634"
        // for the same estate — a data-entry error in CT's own file, not a systematic
        // broker-wide scheme (CT's other ~2000 lots all use ordinary "MF" codes). Grouping by
        // code alone would have silently split CT's real Alagalla volume into its own
        // "SS0634" group, which never even renders (no ASC lot shares that code, so it fails
        // the shared-with-ASC filter) — undercounting CT's actual share for that mark with no
        // visible sign anything was wrong. A shared exact estate name is as strong a signal
        // of "same estate" as a shared code — tea mark names aren't reused across unrelated
        // estates — so this catches the mismatched-code case without touching the "different
        // code, different name" guarantee (Green Mount vs Green Mount Super, Greenwood vs
        // Midfield) that grouping by code was built to protect in the first place.
        var mergedByName = new Dictionary<string, GroupAccumulator>(StringComparer.OrdinalIgnoreCase);
        foreach (var acc in groups.Values)
        {
            var nameKey = acc.EstateName!;
            if (!mergedByName.TryGetValue(nameKey, out var target))
            {
                mergedByName[nameKey] = acc;
                continue;
            }
            if (string.IsNullOrWhiteSpace(target.Elevation) && !string.IsNullOrWhiteSpace(acc.Elevation))
                target.Elevation = acc.Elevation;
            foreach (var broker in acc.Brokers) target.Brokers.Add(broker);
            foreach (var (broker, qty) in acc.MonthQtyByBroker) Add(target.MonthQtyByBroker, broker, qty);
            foreach (var (broker, qty) in acc.YearQtyByBroker) Add(target.YearQtyByBroker, broker, qty);
            foreach (var (broker, perSale) in acc.SaleQtyByBrokerAndSaleNo)
            {
                if (!target.SaleQtyByBrokerAndSaleNo.TryGetValue(broker, out var targetPerSale))
                    target.SaleQtyByBrokerAndSaleNo[broker] = targetPerSale = new Dictionary<int, decimal>();
                foreach (var (saleNo, qty) in perSale)
                    targetPerSale[saleNo] = targetPerSale.GetValueOrDefault(saleNo) + qty;
            }
        }

        return mergedByName
            // Scoped to the displayed month, not "shared at any point this year": Brokers
            // accumulates across the whole year (it feeds YearQtyByBroker), so a mark last
            // shared in an earlier month would otherwise pass this filter and produce a
            // dangling estate-header row with nothing under it — no broker has any entry in
            // MonthQtyByBroker to write, since none of its lots fell in this month (found
            // live: "Win Hills" rendered as an empty row with zero data beneath it). A
            // report titled for one month should only list marks actually shared that month.
            .Where(kv => kv.Value.MonthQtyByBroker.ContainsKey(AscBrokerCode) && kv.Value.MonthQtyByBroker.Keys.Any(b => b != AscBrokerCode))
            .Select(kv => new SharedMarkCatalogueRow(
                EstateName: System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(kv.Value.EstateName!.ToLowerInvariant()),
                Code: kv.Value.Code!,
                ElevationBucket: string.Equals(kv.Value.Elevation?.Trim(), "L", StringComparison.OrdinalIgnoreCase)
                    ? "Low Grown" : "High & Medium Grown",
                SaleQtyByBrokerAndSaleNo: kv.Value.SaleQtyByBrokerAndSaleNo.ToDictionary(x => x.Key, x => (IReadOnlyDictionary<int, decimal>)x.Value),
                MonthQtyByBroker: kv.Value.MonthQtyByBroker,
                YearQtyByBroker: kv.Value.YearQtyByBroker))
            // By code, not estate name, per explicit instruction — e.g. "BF..." codes sort
            // ahead of "MF..."/"SS..." ones. CodeSortKey, not a raw string compare: a plain
            // string sort puts "MF10" before "MF2" (comparing character by character), when
            // ascending numeric order within a prefix means MF2 comes first — codes need to
            // read 1, 2, 3 ... 10, 11, not 1, 10, 11, 2, 3. Ties (shouldn't happen — codes
            // are the grouping key) broken by name for determinism.
            .OrderBy(r => CodeSortKey(r.Code))
            .ThenBy(r => r.EstateName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Splits a normalized code (e.g. "MF634", "MF634C") into (letter prefix,
    /// numeric part, trailing letters) so rows sort in true ascending numeric order within
    /// each prefix — MF2 before MF10 — rather than a plain string compare's MF10 before MF2.
    /// Falls back to sorting the whole string first when a code doesn't match the expected
    /// shape (never happens for a NormalizeMarkCode output, but keeps this total).</summary>
    internal static (string Prefix, int Number, string Suffix) CodeSortKey(string code)
    {
        var m = System.Text.RegularExpressions.Regex.Match(code, @"^([A-Z]*)(\d+)([A-Z]*)$");
        return m.Success
            ? (m.Groups[1].Value, int.Parse(m.Groups[2].Value), m.Groups[3].Value)
            : (code, -1, "");
    }

    private sealed class GroupAccumulator
    {
        public HashSet<string> Brokers { get; } = new(StringComparer.OrdinalIgnoreCase);
        public string? EstateName { get; set; }
        public string? Code { get; set; }
        public string? Elevation { get; set; }
        public Dictionary<string, Dictionary<int, decimal>> SaleQtyByBrokerAndSaleNo { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> MonthQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> YearQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private static void Add(Dictionary<string, decimal> map, string broker, decimal qty) =>
        map[broker] = map.GetValueOrDefault(broker) + qty;

    /// <summary>The grouping/lookup key for a lot: its Trade Mark/Factory code (Lot.Mark),
    /// leading-zero-normalized but with any trailing letter kept — see this class's own doc
    /// comment for why. Falls back to the trimmed Selling Mark text when a lot carries no
    /// code at all, so a code-less lot still groups (with itself/exact spelling matches)
    /// rather than being silently dropped.</summary>
    private static string? GroupKey(Lot lot) =>
        !string.IsNullOrWhiteSpace(lot.Mark) ? NormalizeMarkCode(lot.Mark)
        : !string.IsNullOrWhiteSpace(lot.SellingMark) ? lot.SellingMark.Trim()
        : null;

    /// <summary>Strips only leading zeros after the letter prefix (MF01257 -> MF1257) —
    /// brokers pad differently for the exact same estate (confirmed: MB's MF01257 vs LCBL's
    /// MF1257 for UPLANDS). Deliberately keeps any trailing letter (MF1188 vs MF1188A stay
    /// distinct) — see this class's own doc comment for why collapsing that distinction is
    /// unsafe without a reliable per-factory mapping. Same behavior as
    /// BrokerCatalogueUploadParser.NormalizeFactoryCode's leading-zero handling — kept as a
    /// separate copy rather than shared, matching SaleFileStore's own copy for
    /// GetMarkCodeIndex: each layer normalizes independently rather than taking a
    /// cross-layer dependency for one regex.</summary>
    public static string NormalizeMarkCode(string raw)
    {
        var trimmed = raw.Trim().ToUpperInvariant();
        var m = System.Text.RegularExpressions.Regex.Match(trimmed, @"^([A-Z]+)0*(\d+[A-Z]*)$");
        return m.Success ? $"{m.Groups[1].Value}{m.Groups[2].Value}" : trimmed;
    }

    /// <summary>GroupKey -> (canonical Selling Mark spelling, non-blank Sub Elevation),
    /// first-seen-wins within this set of lots. Used to canonicalize uploaded lots, which
    /// carry a code but no elevation and no guarantee their own spelling matches history.</summary>
    private static Dictionary<string, (string Name, string Elevation)> BuildMarkInfoIndex(IEnumerable<Lot> lots) =>
        lots
            .Where(l => !string.IsNullOrWhiteSpace(l.SellingMark) && !string.IsNullOrWhiteSpace(l.Elevation) && GroupKey(l) is not null)
            .GroupBy(l => GroupKey(l)!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (g.First().SellingMark!.Trim(), g.First().Elevation!), StringComparer.OrdinalIgnoreCase);

    /// <summary>SaleFileStore.SalesInMonth estimates every week's date from a once-a-year
    /// anchor formula for years with no explicit date table yet (e.g. 2026) — close, but it
    /// can drift a day or two from the real calendar (confirmed: the 2026 formula puts sale
    /// 36 on 15 Sep, the real file/upload date is 16 Sep). The target sale's own date is
    /// always known exactly (from /data/sales' ImportedAt or the upload form), so shift
    /// every week in the calendar by that same offset — correct for the sale that matters,
    /// and for its neighbors too since a fixed-formula's drift is constant across a year.</summary>
    private static IReadOnlyList<(int SaleNo, DateTime Date)> AlignCalendarToKnownSaleDate(
        IReadOnlyList<(int SaleNo, DateTime Date)> calendar, int knownSaleNo, DateTime knownDate)
    {
        var estimated = calendar.FirstOrDefault(w => w.SaleNo == knownSaleNo);
        if (estimated == default) return calendar;
        var offset = knownDate.Date - estimated.Date.Date;
        return offset == TimeSpan.Zero ? calendar : calendar.Select(w => (w.SaleNo, w.Date + offset)).ToList();
    }
}
