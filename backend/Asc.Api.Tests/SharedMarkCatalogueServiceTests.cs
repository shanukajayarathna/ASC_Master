using Asc.Api.Models;
using Asc.Api.Modules.MarkIntelligence;
using Asc.Api.Services;

namespace Asc.Api.Tests;

public class SharedMarkCatalogueServiceTests
{
    private sealed class FakeCatalogueSource(
        Catalogue catalogue, List<Lot> lots,
        Dictionary<string, (string Name, string Elevation)>? markCodeIndex = null) : ICatalogueSource
    {
        public IReadOnlyList<Catalogue> ListCatalogues() => [catalogue];
        public Catalogue? GetCatalogue(Guid id) => id == catalogue.Id ? catalogue : null;
        public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => catalogueId == catalogue.Id ? lots : null;
        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => null;
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => [];
        public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => [];
        public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() =>
            markCodeIndex ?? new Dictionary<string, (string Name, string Elevation)>();
        public IReadOnlyDictionary<string, DateTime> GetRecentlySharedFactoryCodeDates() =>
            SaleFileStore.FindSharedFactoryCodesForSale(lots).ToDictionary(c => c, _ => catalogue.ImportedAt, StringComparer.OrdinalIgnoreCase);
    }

    // Factory is derived from the given code with the trailing letter stripped, matching how
    // real /data/sales rows carry it separately from Trade Mark (e.g. Lot("MF1188A", ...)
    // gets Factory "MF1188", the same way "BF0020"/"BF0020A" both genuinely carry Factory
    // "BF0020" in real data) — used only by PairOrthodoxAndCtc's physical-factory matching.
    // Mark keeps the letter, unchanged: GroupKey (BuildRows' own primary grouping) reads
    // Mark, not Factory — see this class's own doc comment.
    private static Lot Lot(string code, string sellingMark, string broker, decimal netWeight,
        bool isReprint = false, string elevation = "L", int saleNo = 36, string? factoryName = null) => new()
    {
        Factory = SharedMarkCatalogueService.NormalizeMarkCode(code),
        Mark = code,
        FactoryName = factoryName,
        SellingMark = sellingMark,
        Broker = broker,
        NetWeight = netWeight,
        IsReprint = isReprint,
        Elevation = elevation,
        SaleNo = saleNo.ToString(),
    };

    private static IReadOnlyList<SharedMarkCatalogueRow> Build(params Lot[] lots) =>
        SharedMarkCatalogueService.BuildRows(lots.Select(l => (l, IsThisMonth: true)));

    private static decimal SaleQty(SharedMarkCatalogueRow row, string broker, int saleNo = 36) =>
        row.SaleQtyByBrokerAndSaleNo.TryGetValue(broker, out var perSale) ? perSale.GetValueOrDefault(saleNo) : 0;

    [Fact]
    public void ReprintLots_AreExcludedFromTotals()
    {
        // Real Sale 36/2026 case: Ransirini's only ASC lot was a reprint — the estate must
        // not appear at all (no non-reprint ASC volume to compare against MC's).
        var rows = Build(
            Lot("MF0020A", "RANSIRINI", "ASC", 497, isReprint: true),
            Lot("MF0020A", "RANSIRINI", "MC", 500));

        Assert.Empty(rows);
    }

    [Fact]
    public void SharedFactoryCode_MergesSubMarks_WhenTrailingLetterIsTheOnlyDifference()
    {
        // Per explicit instruction, confirmed by auditing a hand-built reference for Sale
        // 37/2026 against /data/sales: same factory code number means the same factory, and
        // every non-CTC sub-mark under it merges into one row — including genuinely
        // different-NAMED products that just happen to share a factory (confirmed live:
        // Boscombe/MF0594 and the differently-named "Kinkini"/MF0594A share one Factory; the
        // reference's own "Boscombe" line matches our Boscombe+Kinkini combined total
        // exactly, week by week and Year-to-date — see
        // SameFactorySiblingWithDifferentName_StillMerges_UnlessCtcFlavored). "GREEN MOUNT"
        // (MF1188) and "GREEN MOUNT SUPER" (MF1188A) are the same kind of case: neither name
        // is CTC-flavored, so they merge into one row, labeled by whichever Factory Name/
        // Selling Mark was seen first.
        var rows = Build(
            Lot("MF1188", "GREEN MOUNT", "ASC", 880),
            Lot("MF1188A", "GREEN MOUNT SUPER", "ASC", 940),
            Lot("MF1188", "GREEN MOUNT", "BC", 1000),
            Lot("MF1188A", "GREEN MOUNT SUPER", "BC", 1200));

        var row = Assert.Single(rows);
        Assert.Equal("Green Mount", row.EstateName); // first-seen Selling Mark — no Factory Name on file here
        Assert.Equal("MF1188", row.Code);
        Assert.Equal(1820, SaleQty(row, "ASC"));
        Assert.Equal(2200, SaleQty(row, "BC"));
        Assert.Null(row.ProductionLabel);
    }

    [Fact]
    public void EstateName_PrefersFactoryName_OverFirstSeenSellingMark()
    {
        // Confirmed live: /data/sales' General Report carries a real "Factory Name" column
        // (e.g. "WATADENIYA TEA FACORY") distinct from Selling Mark. A row's display name
        // should show the real Factory Name once any of its own lots carries one, even when
        // an earlier lot for that same code had none — first-seen-wins for a *fallback*, but
        // a real Factory Name always wins once seen.
        var rows = Build(
            Lot("BF0020", "WATADENIYA", "ASC", 500), // no Factory Name on this lot
            Lot("BF0020", "WATADENIYA", "MC", 300, factoryName: "WATADENIYA TEA FACORY"),
            Lot("BF0020", "WATADENIYA", "ASC", 400));

        var row = Assert.Single(rows);
        Assert.Equal("Watadeniya Tea Facory", row.EstateName);
        Assert.Equal(900, SaleQty(row, "ASC"));
    }

    [Fact]
    public void SameFactorySiblingWithDifferentName_StillMerges_UnlessCtcFlavored()
    {
        // Confirmed live against Sale 37/2026: Boscombe (MF0594) and "Kinkini" (MF0594A)
        // share one Factory code AND one Factory Name ("BOSCOMBE TEA FACTORY") in the real
        // /data/sales file despite being two distinct, differently-named products — and the
        // hand-built reference's own "Boscombe" line turns out to be exactly their combined
        // total (confirmed by matching its ASC figures week-by-week and Year-to-date). Per
        // explicit instruction this merges into one row like any other same-factory pair,
        // since neither side is CTC-flavored.
        var rows = Build(
            Lot("MF0594", "BOSCOMBE", "ASC", 1910, factoryName: "BOSCOMBE TEA FACTORY"),
            Lot("MF0594", "BOSCOMBE", "BC", 3910, factoryName: "BOSCOMBE TEA FACTORY"),
            Lot("MF0594A", "KINKINI", "ASC", 320, factoryName: "BOSCOMBE TEA FACTORY"),
            Lot("MF0594A", "KINKINI", "BC", 350, factoryName: "BOSCOMBE TEA FACTORY"));

        var row = Assert.Single(rows);
        Assert.Equal("Boscombe Tea Factory", row.EstateName);
        Assert.Null(row.ProductionLabel);
        Assert.Equal(2230, SaleQty(row, "ASC"));
        Assert.Equal(4260, SaleQty(row, "BC"));
    }

    [Fact]
    public void MismatchedCode_SameExactName_StillMergesIntoOneRow()
    {
        // Real Sale 36/2026 case: CT's own raw file catalogued "Alagalla" under "SS0634"
        // while every other broker (and /data/sales) used "MF0634" for the same estate — a
        // data-entry error in CT's own file (confirmed: CT's other ~2000 lots that sale all
        // use ordinary "MF" codes, so it isn't a systematic broker-wide scheme). Grouping by
        // code alone would silently split CT's real volume into its own "SS0634" group,
        // which never renders (no ASC lot shares that code, so it fails the shared-with-ASC
        // filter) — undercounting CT's actual share with no visible sign anything was wrong.
        // Two groups landing on the exact same final display name are folded together,
        // catching this without touching the "different code, different name" guarantee
        // (Green Mount vs Green Mount Super) grouping by code exists to protect.
        var rows = Build(
            Lot("MF0634", "ALAGALLA", "ASC", 4100, elevation: "L"),
            Lot("SS0634", "ALAGALLA", "CT", 900, elevation: "L")); // CT's mismatched code, same name

        var row = Assert.Single(rows);
        Assert.Equal("Alagalla", row.EstateName);
        Assert.Equal(4100, SaleQty(row, "ASC"));
        Assert.Equal(900, SaleQty(row, "CT"));
        Assert.Equal("Low Grown", row.ElevationBucket);
    }

    [Fact]
    public void DualProductionFactory_SplitsIntoSeparateOrthodoxAndCtcRows()
    {
        // Confirmed against real Sale 36/2026 data and per explicit instruction: a factory
        // that genuinely runs both Orthodox and CTC (Brombil's Orthodox line is MF1465,
        // "DANAWALA"/"DANAWALA CTC" is the same real-data pattern under Factory "MF1375")
        // shows as two separate rows — matching the original hand-built manual PDF's own
        // Orthodox/CTC sub-blocks — not folded into one combined total the way a factory
        // whose sub-marks are all the same production type does (see
        // SharedFactoryCode_MergesSubMarks_WhenTrailingLetterIsTheOnlyDifference). The CTC
        // side is identified from the Selling Mark's own "CTC" wording, not the code.
        var rows = Build(
            Lot("MF1465", "BROMBIL", "ASC", 5596, elevation: "L"),
            Lot("MF1465", "BROMBIL", "CT", 500, elevation: "L"),
            Lot("MF1465C", "BROMBIL CTC", "ASC", 9600, elevation: "L"),
            Lot("MF1465C", "BROMBIL CTC", "CT", 300, elevation: "L"));

        Assert.Equal(2, rows.Count);
        var orthodox = rows.Single(r => r.EstateName == "Brombil");
        var ctc = rows.Single(r => r.EstateName == "Brombil Ctc");
        Assert.Equal(5596, SaleQty(orthodox, "ASC"));
        Assert.Equal(500, SaleQty(orthodox, "CT"));
        Assert.Equal(9600, SaleQty(ctc, "ASC"));
        Assert.Equal(300, SaleQty(ctc, "CT"));
        Assert.Equal("Low Grown", orthodox.ElevationBucket);
        Assert.Equal("Low Grown", ctc.ElevationBucket);
        Assert.Equal("Orthodox", orthodox.ProductionLabel);
        Assert.Equal("Ctc", ctc.ProductionLabel);
        Assert.Equal("Brombil", orthodox.FactoryDisplayName);
        Assert.Equal("Brombil", ctc.FactoryDisplayName);
    }

    [Fact]
    public void CtcOnlySubMark_DoesNotSplit_WhenFactoryHasNoOrthodoxSide()
    {
        // A factory whose Selling Mark always happens to say "Ctc" but never has any
        // non-CTC sibling isn't "a factory with these 2 productions" — nothing to split
        // against, so it renders as one plain row like any single-production factory,
        // exactly as before this feature.
        var rows = Build(
            Lot("MF7777", "SOLITARY CTC", "ASC", 700),
            Lot("MF7777", "SOLITARY CTC", "JK", 600));

        var row = Assert.Single(rows);
        Assert.Equal("Solitary Ctc", row.EstateName);
        Assert.Equal(700, SaleQty(row, "ASC"));
    }

    [Fact]
    public void SameCode_DifferentSpelling_UnifiesUnderOneMark()
    {
        // Confirmed against real Sale 36/2026 data: "MISA" and "MISA TEA" are the exact same
        // mark (both MF1528A) — different brokers/weeks spell it differently. Grouping by
        // code rather than free text means both spellings' volume lands on one row, instead
        // of splitting the same estate's shared volume across two rows that never look
        // "shared" on their own.
        var rows = Build(
            Lot("MF1528A", "MISA", "ASC", 600),
            Lot("MF1528A", "MISA TEA", "ASC", 400),
            Lot("MF1528A", "MISA", "JK", 500));

        var row = Assert.Single(rows);
        Assert.Equal(1000, SaleQty(row, "ASC"));
    }

    [Fact]
    public void Rows_AreOrderedByCode_NotByEstateName()
    {
        // Per explicit instruction: row order follows the Trade Mark/Factory code
        // alphabetically (so "BF..." codes sort ahead of "MF..." ones), not the estate name.
        // Deliberately picked so the two orderings disagree — Zebra Estate's code (BF0001)
        // sorts first even though its name would sort last.
        var rows = Build(
            Lot("MF0002", "AARDVARK ESTATE", "ASC", 100),
            Lot("MF0002", "AARDVARK ESTATE", "JK", 100),
            Lot("BF0001", "ZEBRA ESTATE", "ASC", 100),
            Lot("BF0001", "ZEBRA ESTATE", "JK", 100));

        Assert.Equal(["Zebra Estate", "Aardvark Estate"], rows.Select(r => r.EstateName).ToArray());
        // Codes come back leading-zero-normalized (NormalizeMarkCode) — BF0001 -> BF1, MF0002 -> MF2.
        Assert.Equal(["BF1", "MF2"], rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public void Rows_SortCodesInAscendingNumericOrder_NotPlainStringOrder()
    {
        // A plain string compare puts "MF10" before "MF2" (comparing character by
        // character: '1' < '2'), but ascending code order means MF2, MF3, MF10 — matching
        // how the codes themselves are read, not how they sort as text.
        var rows = Build(
            Lot("MF10", "TENTH ESTATE", "ASC", 100), Lot("MF10", "TENTH ESTATE", "JK", 100),
            Lot("MF2", "SECOND ESTATE", "ASC", 100), Lot("MF2", "SECOND ESTATE", "JK", 100),
            Lot("MF3", "THIRD ESTATE", "ASC", 100), Lot("MF3", "THIRD ESTATE", "JK", 100));

        Assert.Equal(["MF2", "MF3", "MF10"], rows.Select(r => r.Code).ToArray());
    }

    [Fact]
    public void EstateWithNoOtherBroker_IsExcluded_NotAShareYet()
    {
        var rows = Build(Lot("MF0001", "SOLO ESTATE", "ASC", 1000));
        Assert.Empty(rows);
    }

    [Fact]
    public void MarkSharedOnlyEarlierInTheYear_IsExcluded_NotADanglingRow()
    {
        // Real Sale 36/2026 case: "Win Hills" had genuine ASC+other-broker volume
        // somewhere earlier in the year but none in September, the displayed month —
        // an earlier version's "shared" filter checked year-wide presence (Brokers,
        // which feeds YearQtyByBroker) rather than the displayed month, so a mark like
        // this still passed the filter and rendered as an estate-header row with zero
        // broker rows under it (nothing in MonthQtyByBroker to write). "Shared" must be
        // scoped to the same month being displayed.
        var rows = SharedMarkCatalogueService.BuildRows(
        [
            (Lot("MF0001", "WIN HILLS", "ASC", 1000), false), // earlier in the year — not this month
            (Lot("MF0001", "WIN HILLS", "CT", 900), false),
        ]);

        Assert.Empty(rows);
    }

    [Fact]
    public void ElevationBucket_LowVsHighAndMedium_SplitsByRawSubElevation()
    {
        var rows = Build(
            Lot("MF0001", "LOW ESTATE", "ASC", 100, elevation: "L"),
            Lot("MF0001", "LOW ESTATE", "JK", 100, elevation: "L"),
            Lot("MF0002", "HIGH ESTATE", "ASC", 100, elevation: "WH"),
            Lot("MF0002", "HIGH ESTATE", "JK", 100, elevation: "WH"));

        Assert.Equal("Low Grown", rows.Single(r => r.EstateName == "Low Estate").ElevationBucket);
        Assert.Equal("High & Medium Grown", rows.Single(r => r.EstateName == "High Estate").ElevationBucket);
    }

    [Fact]
    public void ElevationBucket_IgnoresBlankElevationLots_EvenWhenEnumeratedFirst()
    {
        // Real Sale 36/2026 case: several genuinely Low Grown marks (Alagalla, Allen Valley,
        // New Rasagalla, Kamarangapitiya among others) have a blank Sub Elevation on some
        // weeks' lots and "L" on others. `acc.Elevation ??= lot.Elevation` treated a blank
        // string as "already has a value" (blank isn't null), so whichever lot got
        // enumerated first decided the mark's bucket forever — if that first lot happened to
        // be a blank-elevation one, the mark got stuck on blank and silently fell into the
        // "High & Medium Grown" default, even with a later lot correctly carrying "L".
        var rows = Build(
            Lot("MF0001", "ALAGALLA", "ASC", 100, elevation: ""),
            Lot("MF0001", "ALAGALLA", "ASC", 100, elevation: "L"),
            Lot("MF0001", "ALAGALLA", "JK", 100, elevation: "L"));

        Assert.Equal("Low Grown", rows.Single(r => r.EstateName == "Alagalla").ElevationBucket);
    }

    [Fact]
    public void WeeklyColumns_BucketByEachLotsOwnSaleNo()
    {
        // Two different weeks of the same month for the same mark — each must land in its
        // own Sale-No column, and both must still roll up into the Month total.
        var rows = Build(
            Lot("MF0001", "MULTI WEEK", "ASC", 300, saleNo: 34),
            Lot("MF0001", "MULTI WEEK", "ASC", 400, saleNo: 36),
            Lot("MF0001", "MULTI WEEK", "JK", 100, saleNo: 34));

        var row = Assert.Single(rows);
        Assert.Equal(300, SaleQty(row, "ASC", 34));
        Assert.Equal(400, SaleQty(row, "ASC", 36));
        Assert.Equal(700, row.MonthQtyByBroker["ASC"]);
    }

    [Fact]
    public async Task AggregateFromUpload_CanonicalizesNameAndElevation_ByCode_NotByUploadedSpelling()
    {
        // Confirmed against real Sale 36/2026 data: "MISA"/"MISA TEA" share one code
        // (MF1528A). The raw broker files carry no elevation column at all and can't be
        // trusted to spell a mark the same way /data/sales already does, so an uploaded
        // lot's code — not its own spelling — is what's looked up: history knows this code
        // as "MISA TEA" with elevation "L", so that spelling and elevation overwrite
        // whatever the uploaded file itself said ("MISA", no elevation).
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var historicalLots = new List<Lot> { Lot("MF1528A", "MISA TEA", "ASC", 400, saleNo: 34) };
        var source = new FakeCatalogueSource(historicalCatalogue, historicalLots);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF1528A", "MISA", "ASC", 600, saleNo: 36),
            Lot("MF1528A", "MISA", "JK", 500, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null; // raw broker files carry no elevation column

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.Equal("Misa Tea", row.EstateName);
        Assert.Equal("Low Grown", row.ElevationBucket);
        Assert.Empty(result.UnmatchedMarks); // resolved — nothing to flag
    }

    [Fact]
    public async Task AggregateFromUpload_NoHistoryForCode_KeepsUploadedSpelling_DefaultsHighAndMedium_AndFlagsIt()
    {
        // A code that's never sold before under any spelling has nothing to canonicalize
        // against — the uploaded file's own spelling is kept, and elevation falls back to
        // the same "High & Medium Grown" default BuildRows already uses for any unresolved
        // mark, per explicit instruction (not flagged for manual review by defaulting the
        // bucket) — but it IS surfaced via UnmatchedMarks so the caller can tell this
        // particular mark's bucket is a guess, not a confirmed match.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var source = new FakeCatalogueSource(historicalCatalogue, []);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF9999", "BRAND NEW ESTATE", "ASC", 600, saleNo: 36),
            Lot("MF9999", "BRAND NEW ESTATE", "JK", 500, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.Equal("Brand New Estate", row.EstateName);
        Assert.Equal("High & Medium Grown", row.ElevationBucket);
        Assert.Equal(["Brand New Estate"], result.UnmatchedMarks);
    }

    [Fact]
    public async Task AggregateFromUpload_FallsBackToPersistedIndex_WhenThisYearHasNoMatch()
    {
        // A code that hasn't sold THIS year has nothing in historicalTagged, but may still
        // be known from a prior year via SaleFileStore.GetMarkCodeIndex() — the persisted,
        // incrementally-built cross-year index that replaced an earlier, much slower
        // approach (scanning prior-year catalogues fresh on every request, confirmed live to
        // take 30+ minutes). This locks in that the fallback actually reaches that index.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var markCodeIndex = new Dictionary<string, (string Name, string Elevation)>
        {
            ["MF1528|ORTHODOX"] = ("Misa Tea", "L"), // SubGroupKey: factory code (trailing letter stripped) + production side
        };
        var source = new FakeCatalogueSource(historicalCatalogue, [], markCodeIndex);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF1528A", "MISA", "ASC", 600, saleNo: 36),
            Lot("MF1528A", "MISA", "JK", 500, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.Equal("Misa Tea", row.EstateName);
        Assert.Equal("Low Grown", row.ElevationBucket);
        Assert.Empty(result.UnmatchedMarks);
    }

    [Fact]
    public async Task AggregateFromUpload_DualProductionFactory_CanonicalizesEachSideFromItsOwnHistory_NotTheOtherSides()
    {
        // Regression for a real bug found while building the Orthodox/CTC split: a raw
        // pre-sale upload carries no elevation, so both its Orthodox and CTC lots get their
        // Elevation/Selling Mark resolved from history by factory code. Danawala's real
        // Factory Name is the plain "DANAWALA" for BOTH its Orthodox and CTC lots (confirmed
        // live) — a plain factory-level lookup can't tell the two sides apart, so it could
        // hand the CTC lot the Orthodox side's name (or vice versa), erasing the "Ctc"
        // wording BuildRows' own split relies on and silently turning two rows back into
        // one. The fix looks up each side against its OWN historical entry (SubGroupKey), so
        // canonicalizing never crosses from one production type to the other.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var historicalLots = new List<Lot>
        {
            Lot("MF1375", "DANAWALA", "ASC", 400, saleNo: 34, factoryName: "DANAWALA"),
            Lot("MF1375B", "DANAWALA CTC", "ASC", 300, saleNo: 34, factoryName: "DANAWALA"),
        };
        var source = new FakeCatalogueSource(historicalCatalogue, historicalLots);
        var service = new SharedMarkCatalogueService(source);

        // Raw upload files carry no elevation at all — both lots start blank, exactly like a
        // real pre-sale broker file.
        var uploaded = new List<Lot>
        {
            Lot("MF1375", "DANAWALA", "ASC", 4000, saleNo: 36),
            Lot("MF1375", "DANAWALA", "BC", 16100, saleNo: 36),
            Lot("MF1375B", "DANAWALA CTC", "ASC", 3780, saleNo: 36),
            Lot("MF1375B", "DANAWALA CTC", "BC", 18000, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        Assert.Equal(2, result.Rows.Count);
        var orthodox = result.Rows.Single(r => r.EstateName == "Danawala");
        var ctc = result.Rows.Single(r => r.EstateName == "Danawala Ctc");
        Assert.Equal(4000, SaleQty(orthodox, "ASC"));
        Assert.Equal(3780, SaleQty(ctc, "ASC"));
        Assert.Equal("Orthodox", orthodox.ProductionLabel);
        Assert.Equal("Ctc", ctc.ProductionLabel);
        Assert.Empty(result.UnmatchedMarks);
    }

    [Fact]
    public async Task AggregateFromUpload_OrthodoxFactoryNameContainingCtcWord_DoesNotMisbucketTheWholeSide()
    {
        // Real Sale 37/2026 bug: Brombil's real Factory Name is literally "BROMBIL ORTHODOX
        // & CTC TEA FACTORY" (confirmed live) — the factory's own registered name mentions
        // both production types. An uploaded Orthodox lot (blank elevation, like every raw
        // pre-sale file) gets canonicalized against history and, before the fix, picked up
        // that Factory Name as its own Selling Mark; BuildRows then re-derives the lot's own
        // Orthodox/CTC split from that (now-overwritten) Selling Mark, saw the word "CTC" in
        // it, and silently filed an entire broker-week of genuine Orthodox volume into the
        // CTC row instead. The fix rejects a CTC-worded Factory Name for the Orthodox side's
        // canonicalized name, falling back to Selling Mark instead.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var historicalLots = new List<Lot>
        {
            Lot("MF1465", "BROMBIL", "ASC", 5000, saleNo: 34, factoryName: "BROMBIL ORTHODOX & CTC TEA FACTORY"),
            Lot("MF1465C", "BROMBIL CTC", "ASC", 4000, saleNo: 34, factoryName: "BROMBIL ORTHODOX & CTC TEA FACTORY"),
            Lot("MF1465C", "BROMBIL CTC", "CT", 3000, saleNo: 34, factoryName: "BROMBIL ORTHODOX & CTC TEA FACTORY"),
        };
        var source = new FakeCatalogueSource(historicalCatalogue, historicalLots);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF1465", "BROMBIL", "ASC", 6180, saleNo: 36),
            Lot("MF1465", "BROMBIL", "CT", 9910, saleNo: 36),
            Lot("MF1465C", "BROMBIL CTC", "ASC", 9600, saleNo: 36),
            Lot("MF1465C", "BROMBIL CTC", "CT", 19200, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        Assert.Equal(2, result.Rows.Count);
        var orthodox = result.Rows.Single(r => r.ProductionLabel == "Orthodox");
        var ctc = result.Rows.Single(r => r.ProductionLabel == "Ctc");
        // The bug moved this exact ASC/CT volume from the Orthodox row into the Ctc row.
        Assert.Equal(6180, SaleQty(orthodox, "ASC"));
        Assert.Equal(9910, SaleQty(orthodox, "CT"));
        Assert.Equal(9600, SaleQty(ctc, "ASC"));
        Assert.Equal(19200, SaleQty(ctc, "CT"));
    }

    [Fact]
    public void FindSharedFactoryCodesForSale_RequiresAscAndAnotherBroker_InTheSameSale()
    {
        // This is the per-sale core SaleFileStore.GetRecentlySharedFactoryCodeDates()
        // incrementally folds in as each new catalogue is indexed — see that method's own
        // doc comment for why the lookback is now a cached date-range filter instead of a
        // full multi-month rescan on every report generation.
        var sharedSale = new List<Lot>
        {
            Lot("MF1350", "BATUWANGALA", "ASC", 5000, saleNo: 34),
            Lot("MF1350", "BATUWANGALA", "MPB", 4000, saleNo: 34),
        };
        var ascOnlySale = new List<Lot>
        {
            Lot("MF9999", "SOLO MARK", "ASC", 1000, saleNo: 34),
        };
        var otherBrokersOnlySale = new List<Lot>
        {
            Lot("MF7777", "NO ASC HERE", "CT", 1000, saleNo: 34),
            Lot("MF7777", "NO ASC HERE", "FW", 900, saleNo: 34),
        };

        var codes = SaleFileStore.FindSharedFactoryCodesForSale(sharedSale)
            .Union(SaleFileStore.FindSharedFactoryCodesForSale(ascOnlySale))
            .Union(SaleFileStore.FindSharedFactoryCodesForSale(otherBrokersOnlySale));

        Assert.Contains("MF1350", codes);
        Assert.DoesNotContain("MF9999", codes);
        Assert.DoesNotContain("MF7777", codes);
    }

    [Fact]
    public async Task AggregateFromUpload_RecentlySharedFactory_KeepsCtcSideEvenWithNoAscVolumeThisSale()
    {
        // Real Sale 37/2026 case: Batuwangala's Orthodox side (BATUWANGALA) is bought by ASC
        // and MPB; its CTC sibling ("INDIGAHAHENA CTC") is only ever bought by CT and FW —
        // ASC has never once touched it. A report generated ahead of the target sale's own
        // close (from raw broker uploads, before /data/sales has this sale's file) must not
        // silently drop that CTC row just because ASC's own upload happens to show zero for
        // it this particular sale — the factory (MF1350) was confirmed ASC-shared via its
        // Orthodox side in the closed sale 3 months' lookback, so per explicit instruction
        // both sides stay in, with ASC zero-filled on the side it never buys.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var historicalLots = new List<Lot>
        {
            Lot("MF1350", "BATUWANGALA", "ASC", 5000, saleNo: 34, factoryName: "BATUWANGALA - CTC"),
            Lot("MF1350", "BATUWANGALA", "MPB", 4000, saleNo: 34, factoryName: "BATUWANGALA - CTC"),
            Lot("MF1350F", "INDIGAHAHENA CTC", "CT", 3000, saleNo: 34, factoryName: "BATUWANGALA - CTC"),
            Lot("MF1350F", "INDIGAHAHENA CTC", "FW", 2000, saleNo: 34, factoryName: "BATUWANGALA - CTC"),
        };
        var source = new FakeCatalogueSource(historicalCatalogue, historicalLots);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF1350", "BATUWANGALA", "ASC", 6000, saleNo: 36),
            Lot("MF1350", "BATUWANGALA", "MPB", 5000, saleNo: 36),
            Lot("MF1350F", "INDIGAHAHENA CTC", "CT", 4000, saleNo: 36),
            Lot("MF1350F", "INDIGAHAHENA CTC", "FW", 3500, saleNo: 36),
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        Assert.Equal(2, result.Rows.Count);
        var orthodox = result.Rows.Single(r => r.ProductionLabel == "Orthodox");
        var ctc = result.Rows.Single(r => r.ProductionLabel == "Ctc");
        Assert.Equal(6000, SaleQty(orthodox, "ASC"));
        Assert.Equal(5000, SaleQty(orthodox, "MPB"));
        Assert.Equal(4000, SaleQty(ctc, "CT"));
        Assert.Equal(3500, SaleQty(ctc, "FW"));
        Assert.True(ctc.MonthQtyByBroker.ContainsKey("ASC"));
        Assert.Equal(0, ctc.MonthQtyByBroker["ASC"]);
    }

    [Fact]
    public async Task AggregateFromUpload_ResolvedViaOneBrokersCode_IsNotFlaggedUnmatched()
    {
        // Real Sale 36/2026 case: "Alagalla" is catalogued by ASC and JK in the same upload,
        // but their raw files don't necessarily use identical codes for the same estate
        // (confirmed live elsewhere in this app: MB's MF01257 vs LCBL's MF1257 for UPLANDS).
        // Checking each uploaded lot's OWN .Elevation in isolation flagged Alagalla as
        // unmatched even though ASC's code resolved correctly and the row's bucket was
        // already right — a false alarm. UnmatchedMarks must only fire when NO lot at all
        // (from any broker or from history) supplied a confirmed elevation for the mark.
        var historicalCatalogue = new Catalogue { Id = Guid.NewGuid(), Year = 2026, ImportedAt = new DateTime(2026, 9, 9) };
        var historicalLots = new List<Lot> { Lot("MF0634", "ALAGALLA", "ASC", 400, saleNo: 34) };
        var source = new FakeCatalogueSource(historicalCatalogue, historicalLots);
        var service = new SharedMarkCatalogueService(source);

        var uploaded = new List<Lot>
        {
            Lot("MF0634", "ALAGALLA", "ASC", 600, saleNo: 36),
            Lot("MF0634X", "ALAGALLA", "JK", 500, saleNo: 36), // JK's file uses a different code for the same estate
        };
        foreach (var lot in uploaded) lot.Elevation = null;

        var result = await service.AggregateFromUploadAsync(2026, 36, new DateTime(2026, 9, 16), uploaded, CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.Equal("Low Grown", row.ElevationBucket);
        Assert.Empty(result.UnmatchedMarks);
    }
}
