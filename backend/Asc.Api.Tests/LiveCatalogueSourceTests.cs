using Asc.Api.Modules.Oklo;
using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Asc.Api.Tests;

/// <summary>
/// Single-sale reads (Top Price, Dashboard, exports, ...) go through LiveCatalogueSource.GetLots: live first,
/// with the file as cache/fallback. These tests pin the rules — active sales are live even when a stale file
/// exists, finished sales a file covers stay on the file, file-less old sales load live only a couple per
/// window, and a failing OKLO falls back to the file.
/// </summary>
public class LiveCatalogueSourceTests
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

    private sealed class Feed : IOkloFeed
    {
        public List<OkloLot> Lots { get; set; } = [];
        public List<OkloCatalog> Catalogs { get; set; } = [];
        public bool Down { get; set; }
        public int PageCalls;
        public bool IsConfigured => true;
        public Task<List<OkloCatalog>> ListCatalogsAsync(CancellationToken ct) => Task.FromResult(Catalogs);

        public Task<OkloPage<OkloLot>> GetGeneralReportPageAsync(int catalogId, int pageNumber, int pageSize, CancellationToken ct, bool background = false)
        {
            Interlocked.Increment(ref PageCalls);
            if (Down) throw new HttpRequestException("OKLO down");
            return Task.FromResult(new OkloPage<OkloLot>(Lots.Skip((pageNumber - 1) * pageSize).Take(pageSize).ToList(), Lots.Count));
        }
    }

    private static List<OkloLot> MakeLots(int n, string status = "Unsold", string buyer = "") => Enumerable.Range(1, n).Select(i => new OkloLot
    {
        AuctionItemId = 5000 + i, Broker = "ASC", BrokerLotNumber = i, SellingMark = "M" + i, Grade = "BOP", InvoiceNumber = i.ToString("0000"),
        SubElevation = "WH", AuctionName = "Sale", CategoryName = "Ex-estate", RePrint = "No", TradeMark = "MF" + i, Units = 10,
        PerUnitWeight = 50m, TotalWeight = 500m, AuctionItemStatus = status, Buyer = buyer, BiddingPrice = buyer.Length > 0 ? 1500m : 0m,
        SellingEndTime = "2026-09-23T08:06:14.8933333", Factory = "MF" + i, FactoryName = "F" + i,
    }).ToList();

    private static OkloCatalog Cat(int id, int saleNo, DateTime date, string status = "Auctioned") =>
        new() { Id = id, SaleNumber = saleNo.ToString(), Name = "Sale " + saleNo, AuctionDate = date, StatusName = status, StatusId = status == "Open" ? 3 : 1020 };

    private sealed class Rig : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "asc-lcs-tests-" + Guid.NewGuid());
        public SaleFileStore Store { get; }
        public Feed Feed { get; } = new();
        public LiveCatalogueSource Source { get; }

        public Rig()
        {
            var content = Path.Combine(Root, "backend", "Asc.Api");
            Directory.CreateDirectory(content);
            Store = new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = content });
            var live = new OkloLiveSales(Feed, Store, Options.Create(new OkloOptions { LivePageSize = 100 }), NullLogger<OkloLiveSales>.Instance);
            Source = new LiveCatalogueSource(Store, live);
        }

        public void WriteFile(int year, int saleNo, IEnumerable<OkloLot> lots) =>
            OkloSaleWriter.Write(Path.Combine(Root, "data", "sales", year.ToString(), $"{saleNo:00}.xlsx"),
                lots.OrderBy(l => l.Broker, StringComparer.Ordinal).ThenBy(l => l.BrokerLotNumber).Select(OkloSaleMapper.MapRow).ToList());

        public void Dispose() { try { Directory.Delete(Root, true); } catch { } }
    }

    private static DateTime Recent => DateTime.UtcNow.Date.AddDays(-3);

    [Fact]
    public void AnActiveSaleWithNoFile_IsServedLive()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(1, 37, Recent)];
        rig.Feed.Lots = MakeLots(30);
        var lots = rig.Source.GetLots(SaleFileStore.CatalogueIdFor(Recent.Year, 37));
        Assert.NotNull(lots);
        Assert.Equal(30, lots!.Count);
    }

    [Fact]
    public void AnActiveSale_PrefersLiveOverAFileThatIsNoLongerRefreshed()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(1, 37, Recent)];
        rig.WriteFile(Recent.Year, 37, MakeLots(30));               // the stale file: nothing sold yet
        rig.Feed.Lots = MakeLots(30, "Sold", "FIN");                // OKLO now: everything sold
        var lots = rig.Source.GetLots(SaleFileStore.CatalogueIdFor(Recent.Year, 37))!;
        Assert.All(lots, l => Assert.Equal("FIN", l.Buyer));
    }

    [Fact]
    public void AFinishedSaleThatAFileCovers_StaysOnTheFile_WithoutTouchingOkloAtAll()
    {
        using var rig = new Rig();
        var old = new DateTime(2024, 3, 5);
        rig.Feed.Catalogs = [Cat(2, 10, old)];
        rig.WriteFile(2024, 10, MakeLots(12));
        var lots = rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, 10));
        Assert.Equal(12, lots!.Count);
        Assert.Equal(0, rig.Feed.PageCalls);
    }

    [Fact]
    public void OldSalesWithNoFile_LoadLive_ButOnlyTwoPerWindow()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(3, 10, new DateTime(2024, 3, 5)), Cat(4, 11, new DateTime(2024, 3, 12)), Cat(5, 12, new DateTime(2024, 3, 19))];
        rig.Feed.Lots = MakeLots(8);
        Assert.Equal(8, rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, 10))!.Count);
        Assert.Equal(8, rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, 11))!.Count);
        // The third would be a sweep's next sale: skipped (as before this feature) rather than another long download.
        Assert.Null(rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, 12)));
        // A sale already in memory is free to read again.
        Assert.Equal(8, rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2024, 10))!.Count);
    }

    [Fact]
    public void WhenOkloIsDown_AnActiveSaleFallsBackToItsFile()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(1, 37, Recent)];
        rig.WriteFile(Recent.Year, 37, MakeLots(30));
        rig.Feed.Down = true;
        var lots = rig.Source.GetLots(SaleFileStore.CatalogueIdFor(Recent.Year, 37));
        Assert.NotNull(lots);
        Assert.Equal(30, lots!.Count);
    }

    [Fact]
    public void ASaleOklodoesNotKnow_IsJustTheFile()
    {
        using var rig = new Rig();
        rig.Feed.Catalogs = [Cat(1, 37, Recent)];
        rig.WriteFile(2019, 5, MakeLots(9)); // not an OKLO sale at all
        Assert.Equal(9, rig.Source.GetLots(SaleFileStore.CatalogueIdFor(2019, 5))!.Count);
        Assert.Equal(0, rig.Feed.PageCalls);
    }
}
