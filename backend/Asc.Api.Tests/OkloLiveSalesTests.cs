using Asc.Api.Modules.Oklo;
using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Asc.Api.Tests;

/// <summary>
/// The live view loads a sale from OKLO into memory page by page. These tests use a fake feed to prove
/// the behaviour the catalogue page depends on: rows appear before the sale is complete, a refresh
/// keeps lot ids stable, live lots are identical to file-built lots, and a failing OKLO never
/// serves half a sale as if it were whole.
/// </summary>
public class OkloLiveSalesTests
{
    private sealed class FakeEnv : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "t";
        public string EnvironmentName { get; set; } = "Development";
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class FakeFeed : IOkloFeed
    {
        public List<OkloLot> Lots { get; set; } = [];
        public List<OkloCatalog> Catalogs { get; set; } = [];
        public Func<int, Task>? BeforePage { get; set; }
        public bool FailFromPage2 { get; set; }
        public int PageCalls;
        public bool IsConfigured => true;
        public Task<List<OkloCatalog>> ListCatalogsAsync(CancellationToken ct) => Task.FromResult(Catalogs);

        public async Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, int pageSize, CancellationToken ct, bool background = false)
        {
            Interlocked.Increment(ref PageCalls);
            if (BeforePage is not null) await BeforePage(pageNumber);
            if (FailFromPage2 && pageNumber >= 2) throw new HttpRequestException("OKLO 500");
            var rows = Lots.Skip((pageNumber - 1) * pageSize).Take(pageSize).ToList();
            return new OkloPage<OkloLot>(rows, Lots.Count);
        }
    }

    private static List<OkloLot> MakeLots(int n, int idBase = 1000) => Enumerable.Range(1, n).Select(i => new OkloLot
    {
        AuctionItemId = idBase + i, Broker = "ASC", BrokerLotNumber = i, SellingMark = "MARK" + (i % 7), Grade = "BOP",
        InvoiceNumber = i.ToString("0000"), SubElevation = "WH", AuctionName = "Sale 37 - Ex-estate", CategoryName = "Ex-estate",
        RePrint = "No", TradeMark = "MF" + i, Units = 10, PerUnitWeight = 50m, TotalWeight = 500m, BrokerValuation = 1000m + i,
        SellingEndTime = "2026-09-23T08:06:14.8933333", Factory = "MF" + i, FactoryName = "F" + i, AuctionItemStatus = "Unsold",
    }).ToList();

    private static OkloCatalog Cat(int id = 259, string no = "37", string status = "Auctioned", string date = "2026-09-22T00:00:00") =>
        new() { Id = id, SaleNumber = no, Name = "Sale " + no, AuctionDate = DateTime.Parse(date), StatusName = status, StatusId = status == "Open" ? 3 : 1020 };

    private static (OkloLiveSales Live, FakeFeed Feed, string Root) Make(int lots, Action<OkloOptions>? tweak = null)
    {
        var root = Path.Combine(Path.GetTempPath(), "asc-live-tests-" + Guid.NewGuid());
        var content = Path.Combine(root, "backend", "Asc.Api");
        Directory.CreateDirectory(content);
        var store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = content });
        var feed = new FakeFeed { Lots = MakeLots(lots), Catalogs = [Cat()] };
        var o = new OkloOptions { LivePageSize = 100 };
        tweak?.Invoke(o);
        return (new OkloLiveSales(feed, store, Options.Create(o), NullLogger<OkloLiveSales>.Instance), feed, root);
    }

    // Every activity tier gets a zero TTL, so a loaded sale is immediately stale whatever the date.
    private static void AlwaysStale(OkloOptions o) { o.ViewTtlLiveMinutes = 0; o.ViewTtlRecentMinutes = 0; o.ViewTtlArchiveHours = 0; }

    private static Guid Sale37 => SaleFileStore.CatalogueIdFor(2026, 37);

    [Fact]
    public async Task OpeningASale_LoadsItFromOkloIntoMemory_WithTheRealSizeKnownFromTheStart()
    {
        var (live, _, root) = Make(250);
        try
        {
            var snap = await live.GetSnapshotAsync(Sale37, needComplete: true, TimeSpan.FromSeconds(20), default);
            Assert.NotNull(snap);
            Assert.True(snap!.Complete);
            Assert.Equal(250, snap.Lots.Count);
            Assert.Equal(250, snap.Total);
            Assert.Equal(250, snap.Catalogue.RowCount);
            Assert.Equal("Sale 37 - 2026", snap.Catalogue.SourceName);
            Assert.All(snap.Lots, l => Assert.Equal("37", l.SaleNo));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task FirstRowsAreServedBeforeTheRestOfTheSaleHasArrived()
    {
        var (live, feed, root) = Make(250);
        var release = new TaskCompletionSource();
        feed.BeforePage = async page => { if (page >= 2) await release.Task; }; // pages 2+ are held back
        try
        {
            var snap = await live.GetSnapshotAsync(Sale37, needComplete: false, TimeSpan.FromSeconds(20), default);
            Assert.NotNull(snap);
            Assert.False(snap!.Complete);
            Assert.Equal(100, snap.Lots.Count);   // just page 1
            Assert.Equal(250, snap.Total);        // …but the sale's real size is already known

            release.SetResult();
            var whole = await live.GetSnapshotAsync(Sale37, needComplete: true, TimeSpan.FromSeconds(20), default);
            Assert.True(whole!.Complete);
            Assert.Equal(250, whole.Lots.Count);
        }
        finally { release.TrySetResult(); try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task APartialSaleOnlyEverGrowsAtTheEnd_SoTheClientCanAppendJustTheNewRows()
    {
        var (live, feed, root) = Make(350);
        var releasePage2 = new TaskCompletionSource();
        var release = new TaskCompletionSource(); // page 3 onwards
        feed.BeforePage = async page => { if (page == 2) await releasePage2.Task; else if (page >= 3) await release.Task; };
        try
        {
            var afterPage1 = await live.GetSnapshotAsync(Sale37, needComplete: false, TimeSpan.FromSeconds(20), default);
            var firstIds = afterPage1!.Lots.Select(l => l.Id).ToList();
            Assert.Equal(100, firstIds.Count);
            releasePage2.SetResult();

            var deadline = DateTime.UtcNow.AddSeconds(20);
            LiveSnapshot? grown;
            do { await Task.Delay(50); grown = live.Loaded(Sale37)!.Snapshot(); }
            while (grown!.Lots.Count < 200 && DateTime.UtcNow < deadline);

            Assert.Equal(200, grown.Lots.Count);
            Assert.Equal(firstIds, grown.Lots.Take(100).Select(l => l.Id).ToList()); // earlier rows unmoved
            Assert.False(grown.Complete);
        }
        finally { releasePage2.TrySetResult(); release.TrySetResult(); try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task LiveLots_AreIdenticalToLotsBuiltFromAnApiWorkbook()
    {
        var (live, feed, root) = Make(30);
        try
        {
            var snap = await live.GetSnapshotAsync(Sale37, needComplete: true, TimeSpan.FromSeconds(20), default);

            // Same lots written to a workbook and read back through SaleFileStore.
            var content = Path.Combine(root, "backend", "Asc.Api");
            var store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = content });
            var file = Path.Combine(root, "data", "sales", "2026", "37.xlsx");
            OkloSaleWriter.Write(file, feed.Lots.OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.BrokerLotNumber).Select(OkloSaleMapper.MapRow).ToList());
            var fileLots = store.GetLots(SaleFileStore.CatalogueIdFor(2026, 37))!;

            Assert.Equal(fileLots.Select(l => l.Id), snap!.Lots.Select(l => l.Id));
            Assert.Equal(fileLots.Select(l => l.LotNumber), snap.Lots.Select(l => l.LotNumber));
            Assert.Equal(fileLots.Select(l => l.SellingMark), snap.Lots.Select(l => l.SellingMark));
            Assert.Equal(fileLots.Select(l => l.Valuation?.EffectiveValue), snap.Lots.Select(l => l.Valuation?.EffectiveValue));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task ARefresh_PicksUpChangedPrices_AndKeepsEveryLotId()
    {
        var (live, feed, root) = Make(120, AlwaysStale);
        try
        {
            var first = await live.GetSnapshotAsync(Sale37, true, TimeSpan.FromSeconds(20), default);
            var ids = first!.Lots.Select(l => l.Id).ToList();
            Assert.All(first.Lots, l => Assert.Null(l.PurchasedPrice));

            foreach (var l in feed.Lots) { l.AuctionItemStatus = "Sold"; l.BiddingPrice = 1500m; l.Buyer = "FIN"; }
            var before = first.FetchedAtUtc;
            var sale = live.Loaded(Sale37)!;
            // The first load publishes "complete" a moment before it clears its loading flag.
            for (var i = 0; i < 100 && sale.Loading; i++) await Task.Delay(50);
            live.EnsureFresh(sale);
            var deadline = DateTime.UtcNow.AddSeconds(20);
            LiveSnapshot? second;
            do { await Task.Delay(50); second = sale.Snapshot(); }
            while (second!.FetchedAtUtc == before && DateTime.UtcNow < deadline);

            Assert.All(second.Lots, l => { Assert.Equal(1500m, l.PurchasedPrice); Assert.Equal("FIN", l.Buyer); });
            Assert.Equal(ids, second.Lots.Select(l => l.Id).ToList()); // valuations stay attached
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task AFailedRefresh_KeepsServingTheLastCompleteSale()
    {
        var (live, feed, root) = Make(250, AlwaysStale);
        try
        {
            var first = await live.GetSnapshotAsync(Sale37, true, TimeSpan.FromSeconds(20), default);
            Assert.Equal(250, first!.Lots.Count);

            feed.FailFromPage2 = true;
            var sale = live.Loaded(Sale37)!;
            live.EnsureFresh(sale);
            var deadline = DateTime.UtcNow.AddSeconds(20);
            while ((sale.Loading || sale.Error is null) && DateTime.UtcNow < deadline) await Task.Delay(50);

            var after = sale.Snapshot()!;
            Assert.True(after.Complete);              // never a half-loaded sale served as whole
            Assert.Equal(250, after.Lots.Count);
            Assert.NotNull(sale.Error);               // …but the failure is visible
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task ASaleThatCannotBeLoadedAtAll_ReturnsNull_SoTheCallerCanFallBackToFiles()
    {
        var (live, feed, root) = Make(250);
        feed.FailFromPage2 = true;
        feed.Lots = MakeLots(250);
        try
        {
            // Page 1 works (100 rows) so the first rows are served; make even page 1 fail for the null case.
            var failing = new FakeFeed { Lots = MakeLots(10), Catalogs = [Cat()], FailFromPage2 = false, BeforePage = _ => throw new HttpRequestException("down") };
            var store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = Path.Combine(root, "backend", "Asc.Api") });
            var down = new OkloLiveSales(failing, store, Options.Create(new OkloOptions { LivePageSize = 100 }), NullLogger<OkloLiveSales>.Instance);
            Assert.Null(await down.GetSnapshotAsync(Sale37, false, TimeSpan.FromSeconds(10), default));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task OnlyNumberedSalesFromTheFirstYearAreListed_AndMockCataloguesAreIgnored()
    {
        var (live, feed, root) = Make(5);
        feed.Catalogs =
        [
            Cat(259, "37"), Cat(260, "Sale 38-SEP13"), Cat(150, "12", "Auctioned", "2023-03-01T00:00:00"),
            Cat(200, "12", "Auctioned", "2025-03-01T00:00:00"),
        ];
        try
        {
            await live.RefreshDirectoryAsync();
            var nos = live.Directory.Select(r => (r.Year, r.SaleNo)).OrderBy(x => x).ToList();
            Assert.Equal([(2025, 12), (2026, 37)], nos); // 2023 is before FirstYear (2024); the mock sale isn't numbered
            Assert.True(await live.IsLiveAsync(SaleFileStore.CatalogueIdFor(2025, 12)));
            Assert.False(await live.IsLiveAsync(SaleFileStore.CatalogueIdFor(2023, 12)));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public async Task ALotCanBeFoundByIdOnceItsSaleIsInMemory()
    {
        var (live, _, root) = Make(40);
        try
        {
            var snap = await live.GetSnapshotAsync(Sale37, true, TimeSpan.FromSeconds(20), default);
            var lot = snap!.Lots[7];
            var hit = live.FindLoadedLot(lot.Id);
            Assert.NotNull(hit);
            Assert.Equal(lot.LotNumber, hit!.Value.Lot.LotNumber);
            Assert.Null(live.FindLoadedLot(Guid.NewGuid()));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
