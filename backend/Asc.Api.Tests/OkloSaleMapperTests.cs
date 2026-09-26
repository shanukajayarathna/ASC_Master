using Asc.Api.Modules.Oklo;
using Asc.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;

namespace Asc.Api.Tests;

/// <summary>
/// The OKLO mapper must reproduce the hand-downloaded "General Report" export closely enough
/// that SaleFileStore parses API-built files to the same lots. The expected values below come
/// from real comparisons against sale 37/2026 (10,269 lots) — see OkloSaleMapper's doc comment.
/// </summary>
public class OkloSaleMapperTests
{
    private static OkloLot Sample() => new()
    {
        AuctionItemId = 2752916, Broker = "ASC", BrokerLotNumber = 1, SellingMark = "ROBGILL", Grade = "BOP",
        InvoiceNumber = "0227", SubElevation = "WH", AuctionName = "Sale 37 - Ex-estate", CategoryName = "Ex-estate",
        RePrint = "No", RainforestCertified = "Yes", TradeMark = "MF0294", Units = 10, PerUnitWeight = 50.0m, TotalWeight = 500.0m,
        BrokerValuation = 1300m, AskingPrice = 1480m, HighestBid = 1480m, HighestBidBuyer = "FIN",
        SecondHighestBid = 1460m, TotalPrice = 740000m, AuctionItemStatus = "Sold", BiddingPrice = 1480m, Buyer = "FIN",
        BuyerName = "FINLAYS COLOMBO LIMITED", Factory = "MF0294", FactoryName = "ROBGILL ESTATE",
        ManufacturedDate = "2026-08-30", SellingEndTime = "2026-09-23T08:06:14.8933333",
        FinalBuyerCompany = "FINLAYS COLOMBO LIMITED", FinalBuyerCode = "FIN", FinalPrice = 1480m, FinalTotalValue = 740000m,
    };

    private static string Cell(string[] row, string top, string sub = "")
    {
        var i = Enumerable.Range(0, OkloSaleMapper.ColumnCount)
            .First(k => OkloSaleMapper.TopHeaders[k] == top && OkloSaleMapper.SubHeaders[k] == sub);
        return row[i];
    }

    [Fact]
    public void Row_HasOneValuePerColumn() =>
        Assert.Equal(OkloSaleMapper.ColumnCount, OkloSaleMapper.MapRow(Sample()).Length);

    [Fact]
    public void SellingEndTime_IsConvertedFromUtcToSriLankaLocal_InTheExportFormat() =>
        Assert.Equal("23/09/2026 13:36:14:893", Cell(OkloSaleMapper.MapRow(Sample()), "Selling End Time"));

    [Fact]
    public void ManufacturedDate_UsesSlashes() =>
        Assert.Equal("2026/08/30", Cell(OkloSaleMapper.MapRow(Sample()), "Manufactured Date"));

    [Fact]
    public void ManufacturedDate_UnsetIsBlank()
    {
        var lot = Sample(); lot.ManufacturedDate = "0001-01-01T00:00:00";
        Assert.Equal("", Cell(OkloSaleMapper.MapRow(lot), "Manufactured Date"));
    }

    [Fact]
    public void Valuation_SingleValue()
    {
        Assert.Equal("1300", Cell(OkloSaleMapper.MapRow(Sample()), "Valuation"));
    }

    [Fact]
    public void Valuation_RangeWhenUpperAboveLower()
    {
        var lot = Sample(); lot.BrokerValuation = 900m; lot.BrokerUpperValuation = 950m;
        Assert.Equal("900 - 950", Cell(OkloSaleMapper.MapRow(lot), "Valuation"));
    }

    [Fact]
    public void Valuation_NoneIsBlank()
    {
        var lot = Sample(); lot.BrokerValuation = 0m;
        Assert.Equal("", Cell(OkloSaleMapper.MapRow(lot), "Valuation"));
    }

    [Fact]
    public void Numbers_PrintWithoutTrailingZeros_AndZeroIsBlank()
    {
        var lot = Sample(); lot.BiddingPrice = 0m;
        var row = OkloSaleMapper.MapRow(lot);
        Assert.Equal("500", Cell(row, "Total Weight"));
        Assert.Equal("50", Cell(row, "Net Weight"));
        Assert.Equal("", Cell(row, "Purchased Price"));
    }

    [Fact]
    public void FinalBuyer_IsTheCompanyName_CodeGoesInItsOwnColumn()
    {
        var row = OkloSaleMapper.MapRow(Sample());
        Assert.Equal("FINLAYS COLOMBO LIMITED", Cell(row, "Final Buyer", "Buyer Company Name"));
        Assert.Equal("FIN", Cell(row, "", "Buyer Code")); // first blank/Buyer Code column is the registered bid's
    }

    [Fact]
    public void InvoiceNumber_KeepsLeadingZero() =>
        Assert.Equal("0227", Cell(OkloSaleMapper.MapRow(Sample()), "Invoice No"));

    // ---- round trip through the real writer + importer + store ---------------------------

    private sealed class FakeEnv : IWebHostEnvironment
    {
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "Asc.Api.Tests";
        public string EnvironmentName { get; set; } = "Development";
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static (SaleFileStore Store, string SalesDir, string Root) NewStore()
    {
        var root = Path.Combine(Path.GetTempPath(), "asc-oklo-tests-" + Guid.NewGuid());
        var contentRoot = Path.Combine(root, "backend", "Asc.Api");
        Directory.CreateDirectory(contentRoot);
        var sales = Path.Combine(root, "data", "sales");
        Directory.CreateDirectory(sales);
        return (new SaleFileStore(new CatalogueImportService(), new FakeEnv { ContentRootPath = contentRoot }), sales, root);
    }

    private static void WriteSale(string path, params OkloLot[] lots) =>
        OkloSaleWriter.Write(path, lots.Select(OkloSaleMapper.MapRow).ToList());

    [Fact]
    public void ApiBuiltFile_LoadsThroughSaleFileStore_WithTheSameLotFields()
    {
        var (store, sales, root) = NewStore();
        try
        {
            var range = Sample(); range.AuctionItemId = 9; range.BrokerLotNumber = 2; range.BrokerValuation = 900m; range.BrokerUpperValuation = 950m;
            WriteSale(Path.Combine(sales, "2026", "37.xlsx"), Sample(), range);

            var cat = store.ListCatalogues().Single();
            var lots = store.GetLots(cat.Id)!;
            Assert.Equal(2, lots.Count);

            var lot = lots.Single(l => l.LotNumber == "1");
            Assert.Equal("ASC", lot.Broker);
            Assert.Equal("ROBGILL", lot.SellingMark);
            Assert.Equal("MF0294", lot.Factory);
            Assert.Equal("WH", lot.Elevation);
            Assert.Equal(500m, lot.NetWeight);
            Assert.Equal(1480m, lot.PurchasedPrice);
            Assert.Equal("FIN", lot.Buyer);
            Assert.Equal(1300m, lot.Valuation!.ValuationSingle);

            var ranged = lots.Single(l => l.LotNumber == "2");
            Assert.Equal(900m, ranged.Valuation!.ValuationFrom);
            Assert.Equal(950m, ranged.Valuation!.ValuationTo);

            // The real sale date comes from the Selling End Time column, in local time.
            Assert.Equal(new DateTime(2026, 9, 23), store.GetCatalogue(cat.Id)!.SaleDateStart!.Value.Date);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    [Fact]
    public void LotId_SurvivesALiveRefresh_ThatChangesPriceAndStatus()
    {
        var (store, sales, root) = NewStore();
        try
        {
            var path = Path.Combine(sales, "2026", "37.xlsx");
            var unsold = Sample(); unsold.AuctionItemStatus = "Unsold"; unsold.Buyer = ""; unsold.BiddingPrice = 0m; unsold.FinalPrice = 0m;
            WriteSale(path, unsold);
            var catId = store.ListCatalogues().Single().Id;
            var before = store.GetLots(catId)!.Single().Id;

            // The lot sold after the auction: different row content, same OKLO lot key.
            File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(-5));
            WriteSale(path, Sample());
            var after = store.GetLots(catId)!.Single();

            Assert.Equal("FIN", after.Buyer);
            Assert.Equal(before, after.Id);
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
