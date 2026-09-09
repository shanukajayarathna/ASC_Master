using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>One Factory's catalogued quantity per sale this month (every non-CTC sub-mark
/// under the same factory code merged into this row — see BuildRows/GroupKey — with any CTC
/// sub-mark broken out into its own separate row instead, see ExpandToRowCandidates), keyed
/// by sale number per broker, plus month-to-date/year-to-date running totals. Code is the
/// row's Factory code (whichever code was first seen for this factory, pre-reconciliation —
/// see BuildRows) — the report's own row order sorts by this, not by EstateName, per explicit
/// instruction. ProductionLabel is non-null ("Orthodox" or "Ctc") only for a genuinely
/// dual-production factory's two rows (see ExpandToRowCandidates) — null for the
/// overwhelming majority of rows, which stand entirely on their own.</summary>
public record SharedMarkCatalogueRow(
    string EstateName,
    string Code,
    string ElevationBucket, // "Low Grown" or "High & Medium Grown"
    IReadOnlyDictionary<string, IReadOnlyDictionary<int, decimal>> SaleQtyByBrokerAndSaleNo,
    IReadOnlyDictionary<string, decimal> MonthQtyByBroker,
    IReadOnlyDictionary<string, decimal> YearQtyByBroker,
    string? ProductionLabel = null,
    string? FactoryDisplayName = null);

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
/// Grouping is by Factory (Lot.Factory) — the producing factory's own short code, e.g.
/// "BF0020" — not by the Trade Mark/Mark code, which can carry a distinguishing trailing
/// letter per sub-mark under that factory (e.g. "BF0020" vs "BF0020A"). Per explicit
/// instruction, confirmed against a real hand-built reference for Sale 37/2026: every
/// non-CTC sub-mark under one factory code rolls into a single "Orthodox" row — this
/// includes genuinely different-NAMED products that just happen to share a factory
/// (confirmed live: Boscombe/MF0594 and the differently-named "Kinkini"/MF0594A share one
/// Factory — the reference's own "Boscombe" line's ASC figures match our Boscombe+Kinkini
/// combined total exactly, week by week and Year-to-date) — while any CTC-worded sub-mark
/// under that same factory breaks out into its own separate "CTC" row instead of being
/// folded in (see ExpandToRowCandidates). This was tried three ways against real data
/// before landing here: full code, never merged (missed the Boscombe/Kinkini-style silent
/// merges the reference actually does); merge only literal name-matched Orthodox/CTC pairs
/// (too narrow — the reference's Brombil "Orthodox" total turned out to be two of our own
/// differently-coded rows summed together, not a name match); factory-level merge with the
/// CTC portion split out (current) — the one that reproduces the reference's own weekly and
/// Year-to-date figures exactly.
///  - EstateName on the row is the factory's own Factory Name where the data carries one
///    (again a real, separate /data/sales column — confirmed live: "WATADENIYA TEA FACORY",
///    "DANAWALA", "LIVERPOOL TEA FACTORY" — first-seen-wins, upgrading from a
///    lower-confidence fallback the moment a real Factory Name is seen, never downgrading
///    back) UNLESS the lot itself is CTC-flavored (IsCtcSubMark), in which case Selling Mark
///    always wins instead — a CTC code's Factory Name is frequently identical to its
///    Orthodox sibling's (confirmed live: Danawala's Factory Name is the plain "DANAWALA"
///    for both its Orthodox and CTC lots) and would otherwise erase the one thing — the
///    Selling Mark's own "CTC" wording — that both labels the CTC row and lets
///    ExpandToRowCandidates recognize a lot as CTC in the first place. Falls back to
///    first-seen Selling Mark text when no lot for that factory carries a Factory Name at
///    all — the raw pre-sale broker upload files (BrokerCatalogueUploadParser) carry no
///    Factory Name column, only a Selling Mark, so an upload-only report (nothing yet in
///    /data/sales for that factory) still gets a usable label.
///  - Free-text spelling drift within one factory (confirmed live: "MISA"/"MISA TEA" and
///    "NEW PANILKANDA"/"NEW PANILKANDE" share one code) unifies the same way it always has —
///    grouping by a real code rather than free text.
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

        var recentlySharedFactoryCodes = FindRecentlySharedFactoryCodes(saleDate, targetId);
        var rows = BuildRows(taggedLots, recentlySharedFactoryCodes);
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

        var recentlySharedFactoryCodes = FindRecentlySharedFactoryCodes(saleDate, targetId);
        var rows = BuildRows(taggedLots, recentlySharedFactoryCodes);

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
        // Checked against BOTH possible name sources (Factory Name and Selling Mark), since
        // BuildRows' own EstateName can end up being either one depending on which of a
        // factory's lots carried a Factory Name — a row displayed under its Factory Name
        // must still match here even though the elevation-confirming lot itself only ever
        // carried a Selling Mark (or vice versa).
        var namesWithConfirmedElevation = taggedLots
            .Select(t => t.Lot)
            .Where(l => !string.IsNullOrWhiteSpace(l.Elevation))
            .SelectMany(l => new[] { l.FactoryName, l.SellingMark })
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(n!.Trim().ToLowerInvariant()))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // A dual-production factory's CTC row is labeled off its own Selling Mark (or a
        // synthesized "{name} - Ctc" — see ExpandToRowCandidates), which can differ from any
        // one lot's own Factory Name, so the name check above alone would sometimes flag it
        // here even though its elevation is exactly as confirmed as its Orthodox sibling's
        // (both come from the very same factory). Falling back to the row's own Factory
        // code — shared by both split rows and by every lot that fed it, split or not —
        // catches this without weakening the name check's own job of catching CT's
        // mismatched-code case.
        var codesWithConfirmedElevation = taggedLots
            .Select(t => t.Lot)
            .Where(l => !string.IsNullOrWhiteSpace(l.Elevation))
            .Select(GroupKey)
            .Where(k => k is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase)!;

        // Only marks that actually made it into the report — one with no ASC+other-broker
        // share this month never renders anywhere, so flagging it would be noise about
        // something the user can't even see.
        var unmatchedMarks = rows
            .Where(r => !namesWithConfirmedElevation.Contains(r.EstateName) && !codesWithConfirmedElevation.Contains(r.Code))
            .Select(r => r.EstateName)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult(new SharedMarkCatalogueResult(year, saleNo, saleDate, monthCalendar, rows, unmatchedMarks));
    }

    /// <summary>Looks up each lot by SubGroupKey, not the plain factory GroupKey — computed
    /// from the lot's OWN current Selling Mark, which for an as-yet-unresolved uploaded lot
    /// is still its original raw broker-file text (nothing has touched it yet) — so an
    /// Orthodox-side uploaded lot only ever gets canonicalized from history's Orthodox-side
    /// entry, never a dual-production factory's CTC-side one or vice versa. Found live: a
    /// plain factory-level lookup could hand an Orthodox lot a CTC-flavored historical name
    /// (or the reverse) purely because whichever sub-mark's history was indexed first for
    /// that factory happened to win — silently turning IsCtcSubMark's later read of the
    /// (now-overwritten) Selling Mark wrong for that lot afterwards, corrupting BuildRows'
    /// own Orthodox/CTC split for a factory that never actually had that problem.</summary>
    private static void ApplyMarkInfo(IReadOnlyList<Lot> lots, Dictionary<string, (string Name, string Elevation)> markInfoByCode)
    {
        foreach (var lot in lots)
        {
            if (!string.IsNullOrWhiteSpace(lot.Elevation)) continue; // already resolved
            var key = SubGroupKey(lot);
            if (key is not null && markInfoByCode.TryGetValue(key, out var info))
            {
                lot.SellingMark = info.Name;
                lot.Elevation = info.Elevation;
            }
        }
    }

    /// <summary>A Selling Mark counts as this factory's CTC line, not its Orthodox one, when
    /// its own text says so — "\bCTC\b" as a whole word, not a substring, so a hypothetical
    /// mark merely containing "ctc" mid-word wouldn't false-positive (never seen live, but
    /// keeps this precise). Confirmed reliable against real data: every "...CTC"-suffixed
    /// Selling Mark under a dual-production factory (DANAWALA CTC, BROMBIL CTC) carries this
    /// word, and no Orthodox-side Selling Mark for the same factories does. This is a
    /// narrower question than "should this factory split at all" (ExpandToRowCandidates'
    /// own isDualProduction check decides that from the actual data, not from this alone) —
    /// it only ever says which side of an already-known split a given lot belongs to.</summary>
    private static readonly System.Text.RegularExpressions.Regex CtcWordRegex =
        new(@"\bCTC\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

    private static bool IsCtcSubMark(Lot lot) =>
        !string.IsNullOrWhiteSpace(lot.SellingMark) && CtcWordRegex.IsMatch(lot.SellingMark);

    /// <summary>Factory codes (GroupKey) that were shared with ASC in at least one closed
    /// sale within the 3 months before saleDate — an upcoming sale's own report is generated
    /// from the freshly uploaded broker files for that exact sale (see
    /// AggregateFromUploadAsync's own doc comment), whose real ASC volume for a given mark
    /// can genuinely be zero this particular week even though the mark is still a going
    /// concern ASC regularly shares with another broker. Per explicit instruction: checked
    /// per individual closed sale, not summed across the window — ASC and another broker
    /// both appearing in the SAME sale is what counts, even if that's the only sale in the
    /// last 3 months where it happened. This is a fallback signal alongside (not instead of)
    /// BuildRows' own current-month check — see IsSharedRowCandidate — so a mark that is
    /// genuinely, freshly shared this exact month still qualifies even with no lookback
    /// history at all (e.g. a brand new mark).</summary>
    private HashSet<string> FindRecentlySharedFactoryCodes(DateTime saleDate, Guid excludeCatalogueId)
    {
        var lookbackStart = saleDate.AddMonths(-3);
        var lookbackSales = catalogues.ListCatalogues()
            .Where(c => c.Id != excludeCatalogueId && c.ImportedAt.Date >= lookbackStart.Date && c.ImportedAt.Date < saleDate.Date)
            .Select(c => (c.Id, Lots: (IReadOnlyList<Lot>)(catalogues.GetLots(c.Id) ?? [])));
        return FindRecentlySharedFactoryCodes(lookbackSales);
    }

    /// <summary>Pure core of the above — one HashSet build per closed sale in the window
    /// (never across sales), then folded into a single result set. Split out for direct unit
    /// testing without an ICatalogueSource.</summary>
    internal static HashSet<string> FindRecentlySharedFactoryCodes(
        IEnumerable<(Guid Id, IReadOnlyList<Lot> Lots)> lookbackSales)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (_, lots) in lookbackSales)
        {
            var brokersByCode = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var lot in lots)
            {
                if (lot.IsReprint) continue;
                if (string.IsNullOrWhiteSpace(lot.SellingMark)) continue;
                if (lot.NetWeight is not { } qty || qty <= 0) continue;
                var key = GroupKey(lot);
                if (key is null) continue;
                var broker = string.IsNullOrWhiteSpace(lot.Broker) ? "(unknown)" : lot.Broker.Trim().ToUpperInvariant();
                if (!brokersByCode.TryGetValue(key, out var set))
                    brokersByCode[key] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                set.Add(broker);
            }
            foreach (var (code, brokers) in brokersByCode)
            {
                if (brokers.Contains(AscBrokerCode) && brokers.Any(b => !string.Equals(b, AscBrokerCode, StringComparison.OrdinalIgnoreCase)))
                    result.Add(code);
            }
        }
        return result;
    }

    private static void Accumulate(
        HashSet<string> brokers, Dictionary<string, decimal> month, Dictionary<string, decimal> year,
        Dictionary<string, Dictionary<int, decimal>> saleQtyByBroker, string broker, decimal qty, bool isThisMonth, string? saleNoRaw)
    {
        brokers.Add(broker);
        Add(year, broker, qty);
        if (!isThisMonth) return;
        Add(month, broker, qty);
        if (!int.TryParse(saleNoRaw, out var saleNo)) return;
        if (!saleQtyByBroker.TryGetValue(broker, out var perSale))
            saleQtyByBroker[broker] = perSale = new Dictionary<int, decimal>();
        perSale[saleNo] = perSale.GetValueOrDefault(saleNo) + qty;
    }

    /// <summary>Pure grouping/aggregation core — no I/O, fully unit-testable. Groups
    /// non-reprint lots by GroupKey (the Factory code — every non-CTC sub-mark under the
    /// same factory merges into one row, per explicit instruction — see this class's own
    /// doc comment for why), sums NetWeight per broker into per-sale-number/month/year
    /// buckets, and keeps only marks with both ASC and at least one other broker present.
    /// Each lot's own Lot.SaleNo (stamped by SaleFileStore for /data/sales lots, or by
    /// BrokerCatalogueUploadParser for uploaded ones) is what buckets it into a weekly
    /// column — no separate "is this the target sale" flag needed.
    ///
    /// A factory whose lots are ALL one production type (the overwhelming majority) still
    /// renders as a single row, exactly as before. A factory that genuinely runs both
    /// Orthodox and CTC (confirmed live: Danawala, Brombil) additionally tracks a CTC-only
    /// slice of the same totals (GroupAccumulator.Ctc) alongside the combined figures — see
    /// ExpandToRowCandidates for how that becomes two separate rows instead of one, per
    /// explicit instruction, matching the original hand-built manual report's own Orthodox/
    /// CTC sub-blocks for these factories.</summary>
    public static IReadOnlyList<SharedMarkCatalogueRow> BuildRows(
        IEnumerable<(Lot Lot, bool IsThisMonth)> taggedLots,
        IReadOnlySet<string>? recentlySharedFactoryCodes = null)
    {
        recentlySharedFactoryCodes ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
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

            // Only ever lock in a non-blank elevation, and only once. Real /data/sales rows
            // for the same code are inconsistent about carrying a Sub Elevation value at
            // all — plenty of lots (confirmed live: Alagalla, Allen Valley, New Rasagalla,
            // Kamarangapitiya, Palmgarden among others) have it blank on some weeks and "L"
            // on others. The old `??=` treated a blank string as "already has a value"
            // (blank isn't null), so if a blank-elevation lot for a mark happened to be
            // enumerated before a lot carrying the real code, the mark got stuck on blank
            // forever and silently fell into the "High & Medium Grown" default bucket — a
            // real Low Grown estate misclassified for no reason other than lot ordering.
            if (string.IsNullOrWhiteSpace(acc.Elevation) && !string.IsNullOrWhiteSpace(lot.Elevation))
                acc.Elevation = lot.Elevation;
            // Display name: prefer the file's own Factory Name — a real /data/sales column
            // naming the actual factory (confirmed live: "WATADENIYA TEA FACORY") — over the
            // free-text Selling Mark, UNLESS this lot is CTC-flavored (IsCtcSubMark), in
            // which case Selling Mark always wins instead — see this class's own doc
            // comment for why. First-seen-wins, upgrading from a lower-confidence fallback
            // the moment a real Factory Name is seen (raw upload files carry no Factory
            // Name at all, so an upload-only factory keeps whichever Selling Mark it saw
            // first), never downgrading back.
            var isCtcLot = IsCtcSubMark(lot);
            var candidateName = (!isCtcLot && !string.IsNullOrWhiteSpace(lot.FactoryName)) ? lot.FactoryName.Trim() : lot.SellingMark.Trim();
            var candidateIsFactoryName = !isCtcLot && !string.IsNullOrWhiteSpace(lot.FactoryName);
            if (string.IsNullOrWhiteSpace(acc.EstateName) || (candidateIsFactoryName && !acc.EstateNameIsFactoryName))
            {
                acc.EstateName = candidateName;
                acc.EstateNameIsFactoryName = candidateIsFactoryName;
            }
            acc.Code ??= key;
            Accumulate(acc.Brokers, acc.MonthQtyByBroker, acc.YearQtyByBroker, acc.SaleQtyByBrokerAndSaleNo, broker, qty, isThisMonth, lot.SaleNo);

            // Same lot, added again into the factory's CTC-only slice when its own Selling
            // Mark says so — see IsCtcSubMark. Every lot always feeds the combined `acc`
            // totals above regardless; this is purely an additional, narrower tally kept
            // alongside it so a genuinely dual-production factory can be split into two rows
            // later (ExpandToRowCandidates) without a second pass over the lots.
            if (isCtcLot)
            {
                acc.Ctc ??= new CtcSlice();
                // First-seen wins, same as acc.EstateName — always the CTC lot's own Selling
                // Mark (never Factory Name): it's guaranteed to carry the word "CTC" (that's
                // how it got here), which ExpandToRowCandidates falls back to for a factory
                // whose base name already has "CTC" baked into its own Factory Name
                // (confirmed live: Batuwangala's real Factory Name is "BATUWANGALA - CTC" for
                // BOTH its sides) — appending another " - Ctc" there would read as a
                // redundant "Batuwangala - Ctc - Ctc".
                acc.Ctc.Name ??= lot.SellingMark.Trim();
                Accumulate(acc.Ctc.Brokers, acc.Ctc.MonthQtyByBroker, acc.Ctc.YearQtyByBroker, acc.Ctc.SaleQtyByBrokerAndSaleNo, broker, qty, isThisMonth, lot.SaleNo);
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
            if (acc.Ctc is not null)
            {
                target.Ctc ??= new CtcSlice();
                target.Ctc.Name ??= acc.Ctc.Name;
                foreach (var broker in acc.Ctc.Brokers) target.Ctc.Brokers.Add(broker);
                foreach (var (broker, qty) in acc.Ctc.MonthQtyByBroker) Add(target.Ctc.MonthQtyByBroker, broker, qty);
                foreach (var (broker, qty) in acc.Ctc.YearQtyByBroker) Add(target.Ctc.YearQtyByBroker, broker, qty);
                foreach (var (broker, perSale) in acc.Ctc.SaleQtyByBrokerAndSaleNo)
                {
                    if (!target.Ctc.SaleQtyByBrokerAndSaleNo.TryGetValue(broker, out var targetPerSale))
                        target.Ctc.SaleQtyByBrokerAndSaleNo[broker] = targetPerSale = new Dictionary<int, decimal>();
                    foreach (var (saleNo, qty) in perSale)
                        targetPerSale[saleNo] = targetPerSale.GetValueOrDefault(saleNo) + qty;
                }
            }
        }

        return mergedByName.Values
            .SelectMany(ExpandToRowCandidates)
            // Scoped to the displayed month, not "shared at any point this year": Brokers
            // accumulates across the whole year (it feeds YearQtyByBroker), so a mark last
            // shared in an earlier month would otherwise pass this filter and produce a
            // dangling estate-header row with nothing under it — no broker has any entry in
            // MonthQtyByBroker to write, since none of its lots fell in this month (found
            // live: "Win Hills" rendered as an empty row with zero data beneath it). A
            // report titled for one month should only list marks actually shared that month
            // — OR, per explicit instruction, a factory recentlySharedFactoryCodes already
            // confirmed was ASC-shared within the last 3 closed sales' months: a report
            // generated ahead of the target sale's own close (AggregateFromUploadAsync) can
            // genuinely see zero ASC volume for a mark that's still an active, going-concern
            // shared mark, and dropping it silently would be a regression, not a correction.
            // The same filter, applied uniformly after the Orthodox/CTC split, is also what
            // quietly drops whichever split side had no volume this particular month AND
            // wasn't itself in the lookback set — checked at the whole-factory Code level
            // (shared by both split rows) per explicit instruction, so a genuinely
            // dual-production factory recently shared on either side keeps BOTH its Orthodox
            // and CTC rows once one side qualifies, even a side ASC has literally never
            // bought (confirmed live: Batuwangala's Orthodox is ASC-shared; its CTC sibling,
            // "Indigahahena Ctc", never has any ASC lot at all).
            .Where(c => IsSharedRowCandidate(c, recentlySharedFactoryCodes))
            .Select(c =>
            {
                // Zero-fill ASC when a row only qualified via the lookback (not real current
                // data) — see WriteQtyCell in SharedMarkCatalogueWorkbookBuilder, which reads
                // this key's mere presence (not its value) to decide whether to draw ASC's
                // broker row at all.
                if (recentlySharedFactoryCodes.Contains(c.Code) && !c.MonthQtyByBroker.ContainsKey(AscBrokerCode))
                    c.MonthQtyByBroker[AscBrokerCode] = 0m;
                return c;
            })
            .Select(c => new SharedMarkCatalogueRow(
                EstateName: System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(c.EstateName.ToLowerInvariant()),
                Code: c.Code,
                ElevationBucket: string.Equals(c.Elevation?.Trim(), "L", StringComparison.OrdinalIgnoreCase)
                    ? "Low Grown" : "High & Medium Grown",
                SaleQtyByBrokerAndSaleNo: c.SaleQtyByBrokerAndSaleNo.ToDictionary(x => x.Key, x => (IReadOnlyDictionary<int, decimal>)x.Value),
                MonthQtyByBroker: c.MonthQtyByBroker,
                YearQtyByBroker: c.YearQtyByBroker,
                ProductionLabel: c.ProductionLabel,
                FactoryDisplayName: c.FactoryDisplayName is { } fdn ? System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(fdn.ToLowerInvariant()) : null))
            // By code, not estate name, per explicit instruction — e.g. "BF..." codes sort
            // ahead of "MF..."/"SS..." ones. CodeSortKey, not a raw string compare: a plain
            // string sort puts "MF10" before "MF2" (comparing character by character), when
            // ascending numeric order within a prefix means MF2 comes first — codes need to
            // read 1, 2, 3 ... 10, 11, not 1, 10, 11, 2, 3. Ties (an Orthodox/CTC split pair
            // sharing one Code, or the rare genuine collision) broken by name for
            // determinism — which also keeps a split pair's Orthodox row ("Danawala") right
            // ahead of its CTC row ("Danawala Ctc"/"Danawala - Ctc"), since the plain name is
            // (usually) a string prefix of the CTC one.
            .OrderBy(r => CodeSortKey(r.Code))
            .ThenBy(r => r.ProductionLabel == "Ctc" ? 1 : 0)
            .ThenBy(r => r.EstateName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>A row qualifies for the report if it has real current-month ASC + another
    /// broker volume (the original rule), OR its whole-factory Code was recently shared with
    /// ASC per the 3-month lookback (see FindRecentlySharedFactoryCodes) — an "or", not a
    /// replacement, so a mark freshly shared this exact month with no prior history (nothing
    /// yet to look back on) still qualifies on its own.</summary>
    private static bool IsSharedRowCandidate(RowCandidate c, IReadOnlySet<string> recentlySharedFactoryCodes) =>
        (c.MonthQtyByBroker.ContainsKey(AscBrokerCode) && c.MonthQtyByBroker.Keys.Any(b => !string.Equals(b, AscBrokerCode, StringComparison.OrdinalIgnoreCase)))
        || recentlySharedFactoryCodes.Contains(c.Code);

    private sealed record RowCandidate(
        string EstateName, string Code, string? Elevation,
        Dictionary<string, decimal> MonthQtyByBroker, Dictionary<string, decimal> YearQtyByBroker,
        Dictionary<string, Dictionary<int, decimal>> SaleQtyByBrokerAndSaleNo,
        string? ProductionLabel = null, string? FactoryDisplayName = null);

    /// <summary>One factory accumulator becomes one row candidate normally — even one that
    /// happens to carry a non-null Ctc slice, if that slice turns out to be the factory's
    /// ENTIRE volume (a CTC-only factory, no Orthodox side ever) or a negligible sliver with
    /// nothing left over once subtracted. Per explicit instruction, the Orthodox/CTC split
    /// is only worth showing "for the factories with these 2 productions" — genuinely both,
    /// not a factory that merely happens to have one stray CTC-worded lot. That's decided
    /// here from the YEAR-to-date totals (the broadest window already tracked), not just the
    /// displayed month, so a factory doesn't flicker between one row and two from month to
    /// month depending on which side happened to sell that particular week. When it IS a
    /// genuine two-production factory, the combined `acc` figures are split into an Orthodox
    /// remainder (acc's totals minus the Ctc slice, broker-by-broker and sale-by-sale) and
    /// the Ctc slice itself, labeled via ProductionLabel/FactoryDisplayName so the two rows
    /// are never confused for one another even when (confirmed live, Danawala) the Factory
    /// Name doesn't itself say which is which — and so the workbook builder can render them
    /// as one shared factory header with two labeled sub-blocks, matching the original
    /// hand-built report exactly. Both candidates still pass through BuildRows' own "shared
    /// this month" filter afterwards like any other row, so a side with no volume this
    /// particular month simply doesn't render — no separate handling needed for that
    /// here.</summary>
    private static IEnumerable<RowCandidate> ExpandToRowCandidates(GroupAccumulator acc)
    {
        var ctcYearTotal = acc.Ctc?.YearQtyByBroker.Values.Sum() ?? 0m;
        var totalYearTotal = acc.YearQtyByBroker.Values.Sum();
        var isDualProduction = acc.Ctc is not null && ctcYearTotal > 0 && ctcYearTotal < totalYearTotal;

        if (!isDualProduction)
        {
            yield return new RowCandidate(acc.EstateName!, acc.Code!, acc.Elevation, acc.MonthQtyByBroker, acc.YearQtyByBroker, acc.SaleQtyByBrokerAndSaleNo);
            yield break;
        }

        var ctc = acc.Ctc!;
        var ctcName = ctc.Name ?? $"{acc.EstateName} - Ctc";
        yield return new RowCandidate(
            acc.EstateName!, acc.Code!, acc.Elevation,
            Subtract(acc.MonthQtyByBroker, ctc.MonthQtyByBroker),
            Subtract(acc.YearQtyByBroker, ctc.YearQtyByBroker),
            SubtractPerSale(acc.SaleQtyByBrokerAndSaleNo, ctc.SaleQtyByBrokerAndSaleNo),
            ProductionLabel: "Orthodox", FactoryDisplayName: acc.EstateName);
        yield return new RowCandidate(
            ctcName, acc.Code!, acc.Elevation,
            ctc.MonthQtyByBroker, ctc.YearQtyByBroker, ctc.SaleQtyByBrokerAndSaleNo,
            ProductionLabel: "Ctc", FactoryDisplayName: acc.EstateName);
    }

    private static Dictionary<string, decimal> Subtract(Dictionary<string, decimal> total, Dictionary<string, decimal> sub)
    {
        var result = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var (broker, qty) in total)
        {
            var remainder = qty - sub.GetValueOrDefault(broker);
            if (remainder != 0) result[broker] = remainder;
        }
        return result;
    }

    private static Dictionary<string, Dictionary<int, decimal>> SubtractPerSale(
        Dictionary<string, Dictionary<int, decimal>> total, Dictionary<string, Dictionary<int, decimal>> sub)
    {
        var result = new Dictionary<string, Dictionary<int, decimal>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (broker, perSale) in total)
        {
            var subPerSale = sub.GetValueOrDefault(broker);
            var remainder = new Dictionary<int, decimal>();
            foreach (var (saleNo, qty) in perSale)
            {
                var r = qty - (subPerSale?.GetValueOrDefault(saleNo) ?? 0m);
                if (r != 0) remainder[saleNo] = r;
            }
            if (remainder.Count > 0) result[broker] = remainder;
        }
        return result;
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
        public bool EstateNameIsFactoryName { get; set; }
        public string? Code { get; set; }
        public string? Elevation { get; set; }
        public Dictionary<string, Dictionary<int, decimal>> SaleQtyByBrokerAndSaleNo { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> MonthQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> YearQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);

        // Null for the overwhelming majority of factories (single production type) — only
        // allocated the moment a lot whose Selling Mark says "CTC" is seen for this factory.
        // See ExpandToRowCandidates for how (and when) this becomes a second row.
        public CtcSlice? Ctc { get; set; }
    }

    /// <summary>Same shape as the numeric half of GroupAccumulator, kept as its own small
    /// class rather than reusing GroupAccumulator itself since a CTC slice never needs a
    /// name/elevation/code of its own — ExpandToRowCandidates always labels and buckets it
    /// off the parent factory's own identity. Name is the one exception: kept here (rather
    /// than always synthesizing "{base} - Ctc") as the natural label for the common case, and
    /// as a fallback label for the rare factory whose own base name already contains "Ctc" —
    /// see ExpandToRowCandidates.</summary>
    private sealed class CtcSlice
    {
        public string? Name { get; set; }
        public HashSet<string> Brokers { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, Dictionary<int, decimal>> SaleQtyByBrokerAndSaleNo { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> MonthQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, decimal> YearQtyByBroker { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private static void Add(Dictionary<string, decimal> map, string broker, decimal qty) =>
        map[broker] = map.GetValueOrDefault(broker) + qty;

    /// <summary>The grouping/lookup key for a lot: its own Factory code (Lot.Factory) —
    /// the real, separate /data/sales column that already identifies the producing factory
    /// regardless of which sub-mark's Trade Mark code a given lot carries — see this class's
    /// own doc comment. Falls back to Mark (Trade Mark) when a lot carries no Factory at all
    /// (the raw pre-sale broker upload files: BrokerCatalogueUploadParser derives Factory
    /// itself via NormalizeFactoryCode, so this path is mostly a defensive fallback for a
    /// lot that somehow has neither populated), and finally to the trimmed Selling Mark text
    /// when there's no code of any kind, so a code-less lot still groups (with itself/exact
    /// spelling matches) rather than being silently dropped.</summary>
    private static string? GroupKey(Lot lot) =>
        !string.IsNullOrWhiteSpace(lot.Factory) ? NormalizeMarkCode(lot.Factory)
        : !string.IsNullOrWhiteSpace(lot.Mark) ? NormalizeMarkCode(lot.Mark)
        : !string.IsNullOrWhiteSpace(lot.SellingMark) ? lot.SellingMark.Trim()
        : null;

    /// <summary>GroupKey (plain factory code) plus which side of an Orthodox/CTC split — if
    /// any — this lot's own current Selling Mark says it belongs to. Used ONLY for
    /// historical name/elevation lookups (BuildMarkInfoIndex, SaleFileStore.
    /// GetMarkCodeIndex, ApplyMarkInfo), never for BuildRows' own top-level grouping, which
    /// deliberately stays keyed by the plain factory code alone so it can see BOTH
    /// production types together and decide whether to split at all. Keeping the historical
    /// lookup side-aware instead prevents a dual-production factory's Orthodox lot from
    /// being canonicalized against its CTC sibling's historical name (or the reverse) —
    /// found live: a plain factory-level lookup could silently hand an Orthodox lot a
    /// CTC-flavored name pulled from whichever sub-mark's history happened to be indexed
    /// first for that factory, corrupting IsCtcSubMark's later read of that lot.</summary>
    private static string? SubGroupKey(Lot lot) =>
        GroupKey(lot) is { } factoryKey ? $"{factoryKey}|{(IsCtcSubMark(lot) ? "CTC" : "ORTHODOX")}" : null;

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
        var m = System.Text.RegularExpressions.Regex.Match(trimmed, @"^([A-Z]+)0*(\d+)[A-Z]*$");
        return m.Success ? $"{m.Groups[1].Value}{m.Groups[2].Value}" : trimmed;
    }

    /// <summary>SubGroupKey (Factory code + Orthodox/CTC side) -> (canonical display name,
    /// non-blank Sub Elevation), first-seen-wins within this set of lots. Used to
    /// canonicalize uploaded lots, which carry a code but no elevation and no guarantee their
    /// own spelling matches history. Keyed by SubGroupKey rather than the plain factory code
    /// so a dual-production factory's two sides each canonicalize from their OWN matching
    /// history — see SubGroupKey's own doc comment for why that matters.</summary>
    private static Dictionary<string, (string Name, string Elevation)> BuildMarkInfoIndex(IEnumerable<Lot> lots) =>
        lots
            .Where(l => !string.IsNullOrWhiteSpace(l.SellingMark) && !string.IsNullOrWhiteSpace(l.Elevation) && SubGroupKey(l) is not null)
            .GroupBy(l => SubGroupKey(l)!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (SelectCanonicalName(g), g.First().Elevation!), StringComparer.OrdinalIgnoreCase);

    /// <summary>A CTC sub-key's own Selling Mark already says "CTC" — that's how a lot ends
    /// up grouped under this key in the first place — so that's what must survive onto a
    /// canonicalized upload lot for IsCtcSubMark to still read it correctly afterwards. The
    /// factory's shared Factory Name would otherwise erase that distinction (confirmed live:
    /// Danawala's Factory Name is the plain "DANAWALA" for BOTH its Orthodox and CTC lots —
    /// picking it here would hand a CTC lot a name with no CTC wording left in it). An
    /// Orthodox sub-key keeps preferring Factory Name exactly as BuildRows' own EstateName
    /// selection does — UNLESS that Factory Name itself contains the word "CTC" (confirmed
    /// live: Brombil's real Factory Name is literally "BROMBIL ORTHODOX & CTC TEA FACTORY";
    /// Batuwangala's is "BATUWANGALA - CTC"). Applying a CTC-worded name to an Orthodox
    /// upload lot here would come back to bite it: ApplyMarkInfo overwrites the lot's own
    /// Selling Mark with this canonicalized name, and BuildRows later re-derives that same
    /// lot's Orthodox/CTC split from ITS OWN (now-overwritten) Selling Mark — so a
    /// genuinely-Orthodox lot canonicalized to a CTC-worded Factory Name would silently get
    /// mis-bucketed into the CTC row instead, taking a whole broker's week of real Orthodox
    /// volume with it (found live: Sale 37/2026's Brombil week-37 catalogue for every
    /// broker sharing it landed in the CTC row this way). Falling back to Selling Mark in
    /// that one case keeps the Orthodox side's canonicalized name genuinely CTC-free.</summary>
    private static string SelectCanonicalName(IGrouping<string, Lot> g)
    {
        if (g.Key.EndsWith("|CTC", StringComparison.OrdinalIgnoreCase))
            return g.First().SellingMark!.Trim();
        var factoryName = g.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l.FactoryName))?.FactoryName;
        var usable = !string.IsNullOrWhiteSpace(factoryName) && !CtcWordRegex.IsMatch(factoryName) ? factoryName : g.First().SellingMark;
        return usable!.Trim();
    }

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
