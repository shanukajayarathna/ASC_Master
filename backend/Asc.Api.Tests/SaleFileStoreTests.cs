using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Tests;

/// <summary>
/// Covers the year-awareness added to SaleFileStore: (1) the legacy 2026 identity scheme is
/// byte-for-byte frozen (existing stored valuations/reports reference these ids — see the
/// non-negotiable rule in SaleFileStore's class doc comment), (2) multi-year scanning/listing
/// works, and (3) a legacy id and a year-foldered id for the same sale number never collide.
/// </summary>
public class SaleFileStoreTests
{
    // ---- frozen legacy identity --------------------------------------------------------
    // Each literal below was computed independently (MD5 of the documented input string,
    // through .NET's Guid(byte[]) byte layout) rather than by calling the code under test —
    // so a change to the legacy hash formula fails here even if CatalogueIdFor/LotIdFor still
    // only agree with themselves.

    [Fact]
    public void LegacyCatalogueId_Sale5_IsFrozen() =>
        Assert.Equal(Guid.Parse("4586f0e4-868f-bcb9-126b-f0da3d7d5b56"), SaleFileStore.CatalogueIdFor(5));

    [Fact]
    public void LegacyCatalogueId_Sale28_IsFrozen() =>
        Assert.Equal(Guid.Parse("646ff847-49d2-2110-541e-d5a5bc09f365"), SaleFileStore.CatalogueIdFor(28));

    [Fact]
    public void LegacyLotId_Sale5_IsFrozen() =>
        Assert.Equal(Guid.Parse("32280005-9b48-8ccd-4511-b6cb90242a91"), SaleFileStore.LotIdFor(5, "ROWKEY1"));

    [Fact]
    public void LegacyLotId_Sale28_IsFrozen() =>
        Assert.Equal(Guid.Parse("b3ef001c-c7d4-5789-a1ff-ff8af2978298"), SaleFileStore.LotIdFor(28, "ROWKEY1"));

    [Fact]
    public void YearOverload_DispatchesToLegacyFormula_ForYear2026()
    {
        Assert.Equal(SaleFileStore.CatalogueIdFor(5), SaleFileStore.CatalogueIdFor(2026, 5));
        Assert.Equal(SaleFileStore.LotIdFor(5, "ROWKEY1"), SaleFileStore.LotIdFor(2026, 5, "ROWKEY1"));
    }

    [Fact]
    public void FolderedCatalogueId_2025_IsFrozenAndDiffersFromLegacy()
    {
        var id = SaleFileStore.CatalogueIdFor(2025, 5);
        Assert.Equal(Guid.Parse("d05246de-c5e9-f69e-a4c4-98e593b31de8"), id);
        Assert.NotEqual(SaleFileStore.CatalogueIdFor(5), id);
    }

    [Fact]
    public void FolderedLotId_2025_IsFrozenAndDiffersFromLegacy()
    {
        var id = SaleFileStore.LotIdFor(2025, 5, "ROWKEY1");
        Assert.Equal(Guid.Parse("07e90005-abb7-2c8f-b881-4f66f4936365"), id);
        Assert.NotEqual(SaleFileStore.LotIdFor(5, "ROWKEY1"), id);
    }

    // ---- multi-year scanning / listing / next-sale-number --------------------------------

    private sealed class FakeEnv : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "Asc.Api.Tests";
        public string EnvironmentName { get; set; } = "Development";
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }

    /// <summary>Builds a SaleFileStore rooted at a fresh temp dir laid out like the real repo
    /// (SalesDir resolves via ContentRootPath/../../data/sales, see SaleFileStore.SalesDir).</summary>
    private sealed class TempStore : IDisposable
    {
        public SaleFileStore Store { get; }
        public string SalesDir { get; }
        private readonly string _root;

        public TempStore()
        {
            _root = Path.Combine(Path.GetTempPath(), "asc-salefilestore-tests-" + Guid.NewGuid());
            var contentRoot = Path.Combine(_root, "backend", "Asc.Api");
            SalesDir = Path.Combine(_root, "data", "sales");
            Directory.CreateDirectory(contentRoot);
            Directory.CreateDirectory(SalesDir);
            Store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = contentRoot });
        }

        public void Dispose()
        {
            try { Directory.Delete(_root, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    /// <summary>A real, minimally valid .xlsx with 10 populated columns per row — ParseSale's
    /// underlying ExtractTable requires >=10 populated cells for a row to count as data (see
    /// CatalogueImportService.ExtractTable's MinPopulatedCellsForDataRow), so fewer columns
    /// would silently parse to zero rows.</summary>
    private static void WriteMinimalSaleFile(string path, string lotNo, string broker, string grade)
    {
        var headers = new[] { "Lot No", "Broker", "Grade", "Garden", "Category", "Elevation", "Region", "Warehouse", "Mark", "InvoiceNo" };
        var values = new[] { lotNo, broker, grade, "SomeGarden", "SomeCategory", "SomeElevation", "SomeRegion", "SomeWarehouse", "SomeMark", "INV1" };

        var wb = new XSSFWorkbook();
        var sheet = wb.CreateSheet("Sheet1");
        var headerRow = sheet.CreateRow(0);
        for (int i = 0; i < headers.Length; i++) headerRow.CreateCell(i).SetCellValue(headers[i]);
        var dataRow = sheet.CreateRow(1);
        for (int i = 0; i < values.Length; i++) dataRow.CreateCell(i).SetCellValue(values[i]);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var fs = File.Create(path);
        wb.Write(fs);
    }

    [Fact]
    public void ListCatalogues_TagsLegacyRootAndYearSubfolderCorrectly()
    {
        using var t = new TempStore();
        // Content doesn't need to be parseable for a listing entry to appear — ListCatalogues
        // only stats the file; it never opens/parses it (see the class doc comment on the
        // gzip cache — parsing is deferred and cached separately).
        File.WriteAllBytes(Path.Combine(t.SalesDir, "01.xlsx"), []);
        var year2025Dir = Path.Combine(t.SalesDir, "2025");
        Directory.CreateDirectory(year2025Dir);
        File.WriteAllBytes(Path.Combine(year2025Dir, "01.xlsx"), []);

        var list = t.Store.ListCatalogues();

        Assert.Equal(2, list.Count);
        var legacy = Assert.Single(list, c => c.Year == 2026);
        var foldered = Assert.Single(list, c => c.Year == 2025);
        Assert.Equal(SaleFileStore.CatalogueIdFor(1), legacy.Id);
        Assert.Equal(SaleFileStore.CatalogueIdFor(2025, 1), foldered.Id);
        Assert.Equal("Sale 1 - 2026", legacy.SourceName);
        Assert.Equal("Sale 1 - 2025", foldered.SourceName);
    }

    [Fact]
    public void A2026NamedSubfolder_IsRecognizedAsLegacyWithIdenticalIds()
    {
        using var t = new TempStore();
        // 2026 may live flat at the root, under a "2026" subfolder, or split across both —
        // CatalogueIdFor/LotIdFor dispatch off the year value alone, not the file's physical
        // path, so this must hash exactly like a flat legacy file for the same sale number.
        var year2026Dir = Path.Combine(t.SalesDir, "2026");
        Directory.CreateDirectory(year2026Dir);
        File.WriteAllBytes(Path.Combine(year2026Dir, "01.xlsx"), []);

        var list = t.Store.ListCatalogues();

        var entry = Assert.Single(list);
        Assert.Equal(2026, entry.Year);
        Assert.Equal(SaleFileStore.CatalogueIdFor(1), entry.Id);
        Assert.Equal("Sale 1 - 2026", entry.SourceName);
    }

    [Fact]
    public void NextSaleNumber_IsScopedPerYear()
    {
        using var t = new TempStore();
        File.WriteAllBytes(Path.Combine(t.SalesDir, "01.xlsx"), []);
        File.WriteAllBytes(Path.Combine(t.SalesDir, "02.xlsx"), []);
        var year2025Dir = Path.Combine(t.SalesDir, "2025");
        Directory.CreateDirectory(year2025Dir);
        File.WriteAllBytes(Path.Combine(year2025Dir, "01.xlsx"), []);

        Assert.Equal(3, t.Store.NextSaleNumber(2026));
        Assert.Equal(2, t.Store.NextSaleNumber(2025));
        Assert.Equal(1, t.Store.NextSaleNumber(2027));
    }

    [Fact]
    public void GetLots_LegacyAndFolderedSameSaleNo_DoNotCollide()
    {
        using var t = new TempStore();
        WriteMinimalSaleFile(Path.Combine(t.SalesDir, "01.xlsx"), "1", "BrokerA", "GradeA");
        WriteMinimalSaleFile(Path.Combine(t.SalesDir, "2025", "01.xlsx"), "1", "BrokerB", "GradeB");

        var legacyLots = t.Store.GetLots(SaleFileStore.CatalogueIdFor(1));
        var folderedLots = t.Store.GetLots(SaleFileStore.CatalogueIdFor(2025, 1));

        Assert.NotNull(legacyLots);
        Assert.NotNull(folderedLots);
        Assert.Equal("BrokerA", Assert.Single(legacyLots!).Broker);
        Assert.Equal("BrokerB", Assert.Single(folderedLots!).Broker);
        Assert.NotEqual(legacyLots![0].Id, folderedLots![0].Id);
    }

    [Fact]
    public void FindLot_ResolvesBothLegacyAndFolderedIdsForTheSameSaleNo()
    {
        using var t = new TempStore();
        WriteMinimalSaleFile(Path.Combine(t.SalesDir, "01.xlsx"), "1", "BrokerA", "GradeA");
        WriteMinimalSaleFile(Path.Combine(t.SalesDir, "2025", "01.xlsx"), "1", "BrokerB", "GradeB");

        var legacyId = t.Store.GetLots(SaleFileStore.CatalogueIdFor(1))!.Single().Id;
        var folderedId = t.Store.GetLots(SaleFileStore.CatalogueIdFor(2025, 1))!.Single().Id;

        var legacyHit = t.Store.FindLot(legacyId);
        var folderedHit = t.Store.FindLot(folderedId);

        Assert.NotNull(legacyHit);
        Assert.Equal("BrokerA", legacyHit!.Value.Lot.Broker);
        Assert.NotNull(folderedHit);
        Assert.Equal("BrokerB", folderedHit!.Value.Lot.Broker);
    }
}
