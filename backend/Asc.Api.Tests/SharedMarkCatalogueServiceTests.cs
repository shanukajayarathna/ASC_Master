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
    }

    private static Lot Lot(string code, string sellingMark, string broker, decimal netWeight,
        bool isReprint = false, string elevation = "L", int saleNo = 36) => new()
    {
        Factory = code,
        Mark = code, // the grouping/lookup key BuildRows actually reads — see GroupKey
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
    public void SharedMarkCode_NeverMerges_WhenTrailingLetterDistinguishesRealMarks()
    {
        // Confirmed against real Sale 36/2026 data: "GREEN MOUNT" is MF1188, "GREEN MOUNT
        // SUPER" is MF1188A — genuinely different marks, distinguished only by the trailing
        // letter. GroupKey (NormalizeMarkCode) deliberately keeps that letter rather than
        // stripping it. A base-factory-number merge (stripping the letter, treating every
        // sub-mark of a factory as one row) was tried per explicit instruction — confirmed
        // live to be genuinely correct for some pairs (Watadeniya/BF0020 + Ransirini/BF0020A
        // really are the same factory) — but checking a real hand-built reference for Sale
        // 37/2026 turned up THREE different correct behaviors for three different
        // same-base-number families in that one dataset: full merge (Watadeniya/Ransirini),
        // separately-labeled Orthodox/CTC sub-blocks never summed (Danawala, Brombil), and
        // one sibling shown alone while the other doesn't appear at all, merged or separate
        // (Liverpool/Liverpool Super) — with no signal in the code, the name, or the grade
        // that reliably predicts which applies. Per explicit instruction this is shelved
        // until there's a reliable per-factory mapping, so back to never merging: MF1188 and
        // MF1188A stay separate rows, no matter how similar their names look.
        var rows = Build(
            Lot("MF1188", "GREEN MOUNT", "ASC", 880),
            Lot("MF1188A", "GREEN MOUNT SUPER", "ASC", 940),
            Lot("MF1188", "GREEN MOUNT", "BC", 1000),
            Lot("MF1188A", "GREEN MOUNT SUPER", "BC", 1200));

        Assert.Equal(2, rows.Count);
        Assert.Equal(880, SaleQty(rows.Single(r => r.EstateName == "Green Mount"), "ASC"));
        Assert.Equal(940, SaleQty(rows.Single(r => r.EstateName == "Green Mount Super"), "ASC"));
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
    public void CtcSellingMark_IsItsOwnRow_LikeAnyOtherDistinctMark()
    {
        // Confirmed against real Sale 36/2026 data: Brombil's Orthodox and CTC lines carry
        // different codes (MF1465 vs MF1465C) even though they're the same physical estate —
        // the CTC suffix lands on the code, not just the name, so they stay separate rows
        // without any special-casing for "Ctc" in the name. A real hand-built reference for
        // Sale 37/2026 confirms this: Orthodox and CTC lines render as separately labeled
        // sub-blocks, never summed together — merging them into one flat row (tried and
        // reverted — see this class's own doc comment) would have been wrong.
        var rows = Build(
            Lot("MF1465", "BROMBIL", "ASC", 5596, elevation: "L"),
            Lot("MF1465", "BROMBIL", "CT", 500, elevation: "L"),
            Lot("MF1465C", "BROMBIL CTC", "ASC", 9600, elevation: "L"),
            Lot("MF1465C", "BROMBIL CTC", "CT", 300, elevation: "L"));

        Assert.Equal(2, rows.Count);
        Assert.Equal(5596, SaleQty(rows.Single(r => r.EstateName == "Brombil"), "ASC"));
        Assert.Equal(9600, SaleQty(rows.Single(r => r.EstateName == "Brombil Ctc"), "ASC"));
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
            ["MF1528A"] = ("Misa Tea", "L"),
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
