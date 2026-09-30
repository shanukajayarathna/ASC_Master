using Asc.Api.Models;
using Asc.Api.Modules.CategoryAverageTrend;
using Asc.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Tests;

public class CategoryAverageTrendControllerTests
{
    /// <summary>Tracks which catalogues had GetLots() actually called on them — the thing the
    /// SaleDateEnd pre-filter in Latest() exists to avoid for sales that haven't been auctioned yet.</summary>
    private sealed class FakeCatalogueSource(List<(Catalogue Catalogue, List<Lot> Lots)> sales) : ICatalogueSource
    {
        public readonly List<Guid> LotsRequestedFor = [];

        public IReadOnlyList<Catalogue> ListCatalogues() => [.. sales.Select(s => s.Catalogue)];
        public Catalogue? GetCatalogue(Guid id) => sales.FirstOrDefault(s => s.Catalogue.Id == id).Catalogue;

        public IReadOnlyList<Lot>? GetLots(Guid catalogueId)
        {
            LotsRequestedFor.Add(catalogueId);
            return sales.FirstOrDefault(s => s.Catalogue.Id == catalogueId).Lots;
        }

        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => null;
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => [];
        public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => [];
        public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() => new Dictionary<string, (string Name, string Elevation)>();
        public IReadOnlyDictionary<string, DateTime> GetRecentlySharedFactoryCodeDates() => new Dictionary<string, DateTime>();
    }

    private static Lot Sold(string category = "Leafy", string elevation = "L") =>
        new() { Category = category, Elevation = elevation, Grade = "OP", NetWeight = 100, PurchasedPrice = 1000, Status = "Sold" };

    /// <summary>SaleDateEnd null mirrors a real just-uploaded catalogue: full row count, but no
    /// "Selling End Time" values yet because the auction hasn't happened.</summary>
    private static Catalogue Catalogue(int year, int saleNo, DateTime? saleDateEnd) => new()
    {
        Id = SaleFileStore.CatalogueIdFor(year, saleNo),
        Year = year,
        SourceName = $"Sale {saleNo} - {year}",
        SaleDateEnd = saleDateEnd,
    };

    [Fact]
    public void Latest_SkipsUpcomingSales_WithoutEverCallingGetLotsOnThem()
    {
        // Sales 38-40 are uploaded ahead of auction (no SaleDateEnd, full of Pending lots that would
        // wrongly look "sold" if a fake ever needed to be checked) — 37 is the real most recent close.
        var upcoming = new Lot { Category = "Leafy", Elevation = "L", Grade = "OP", NetWeight = 100, Status = "Pending" };
        var source = new FakeCatalogueSource([
            (Catalogue(2026, 40, null), [upcoming]),
            (Catalogue(2026, 39, null), [upcoming]),
            (Catalogue(2026, 38, null), [upcoming]),
            (Catalogue(2026, 37, new DateTime(2026, 9, 23)), [Sold()]),
            (Catalogue(2026, 36, new DateTime(2026, 9, 16)), [Sold()]),
        ]);

        var result = (LatestSaleWithResultsDto)((OkObjectResult)new CategoryAverageTrendController(source).Latest().Result!).Value!;

        Assert.Equal("Sale 37 - 2026", result.SourceName);
        Assert.DoesNotContain(Catalogue(2026, 40, null).Id, source.LotsRequestedFor);
        Assert.DoesNotContain(Catalogue(2026, 39, null).Id, source.LotsRequestedFor);
        Assert.DoesNotContain(Catalogue(2026, 38, null).Id, source.LotsRequestedFor);
        Assert.Contains(Catalogue(2026, 37, new DateTime(2026, 9, 23)).Id, source.LotsRequestedFor);
    }

    [Fact]
    public void Latest_KeepsLookingBack_WhenAnAuctionedSaleHasNoSoldLots()
    {
        // SaleDateEnd set (the auction happened) but every lot fell through unsold — Latest() must
        // fall back to the sale before it rather than stopping at the first auctioned date it sees.
        var allUnsold = new Lot { Category = "Leafy", Elevation = "L", Grade = "OP", NetWeight = 100, Status = "Unsold" };
        var source = new FakeCatalogueSource([
            (Catalogue(2026, 38, new DateTime(2026, 9, 20)), [allUnsold]),
            (Catalogue(2026, 37, new DateTime(2026, 9, 23)), [Sold()]),
        ]);

        var result = (LatestSaleWithResultsDto)((OkObjectResult)new CategoryAverageTrendController(source).Latest().Result!).Value!;

        Assert.Equal("Sale 37 - 2026", result.SourceName);
    }

    [Fact]
    public void Get_ReturnsNotFound_ForAnUnknownCatalogue()
    {
        var source = new FakeCatalogueSource([(Catalogue(2026, 37, new DateTime(2026, 9, 23)), [Sold()])]);
        var result = new CategoryAverageTrendController(source).Get(Guid.NewGuid(), null).Result;
        Assert.IsType<NotFoundResult>(result);
    }
}
