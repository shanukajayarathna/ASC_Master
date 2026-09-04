using Asc.Api.Models;
using Asc.Api.Modules.MarketBulletin;
using Asc.Api.Services;

namespace Asc.Api.Tests;

public class MarketBulletinControllerTests
{
    private sealed class FakeCatalogueSource(List<Catalogue> catalogues) : ICatalogueSource
    {
        public IReadOnlyList<Catalogue> ListCatalogues() => catalogues.OrderByDescending(c => c.ImportedAt).ToList();
        public Catalogue? GetCatalogue(Guid id) => catalogues.FirstOrDefault(c => c.Id == id);
        public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => GetCatalogue(catalogueId) is null ? null : [];
        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => null;
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => [];
        public IReadOnlyList<(int SaleNo, DateTime Date)> SalesInMonth(int year, int month) => [];
        public IReadOnlyDictionary<string, (string Name, string Elevation)> GetMarkCodeIndex() => new Dictionary<string, (string Name, string Elevation)>();
    }

    private static Catalogue Sale(int year, int saleNo, DateTime importedAt) => new()
    {
        Id = SaleFileStore.CatalogueIdFor(year, saleNo),
        Year = year,
        SourceName = $"Sale {saleNo} - {year}",
        ImportedAt = importedAt,
    };

    [Fact]
    public void PreviousCatalogue_UsesSaleNumberArithmetic_NotImportTimestampOrder()
    {
        // Real bug scenario: a bulk historical import processed sale files in an order that
        // doesn't match sale-number order (e.g. lexical "10" before "9"), so Sale 10's
        // ImportedAt ends up EARLIER than Sale 9's. ListCatalogues() (desc by ImportedAt)
        // therefore orders them [sale9, sale10] — sale9 LAST-in-time but FIRST in the list.
        // The old, now-removed logic picked "previous" as the next item after a catalogue's
        // own position in that list: for sale10 (last in the list) that found nothing, and for
        // sale9 it wrongly returned sale10 — a LATER sale mislabeled as "last week". Sale-number
        // arithmetic must get both right regardless of import order.
        var sale9 = Sale(2024, 9, new DateTime(2026, 9, 1, 10, 0, 0));
        var sale10 = Sale(2024, 10, new DateTime(2026, 9, 1, 9, 0, 0)); // imported BEFORE sale 9
        var source = new FakeCatalogueSource([sale9, sale10]);

        var previousOf10 = MarketBulletinController.PreviousCatalogue(source, sale10);
        Assert.NotNull(previousOf10);
        Assert.Equal(sale9.Id, previousOf10!.Id);
        Assert.Equal("Sale 9 - 2024", previousOf10.SourceName);

        // Sale 8 was never imported, so sale9 correctly has no previous — NOT sale10.
        Assert.Null(MarketBulletinController.PreviousCatalogue(source, sale9));
    }

    [Fact]
    public void PreviousCatalogue_FirstSaleOfYear_ReturnsNull()
    {
        var sale1 = Sale(2024, 1, DateTime.UtcNow);
        var source = new FakeCatalogueSource([sale1]);

        Assert.Null(MarketBulletinController.PreviousCatalogue(source, sale1));
    }

    [Fact]
    public void PreviousCatalogue_PriorSaleNotOnDisk_ReturnsNull()
    {
        // Sale 20 exists but Sale 19 was never imported — no previous-sale data to show,
        // not a wrong one.
        var sale20 = Sale(2024, 20, DateTime.UtcNow);
        var source = new FakeCatalogueSource([sale20]);

        Assert.Null(MarketBulletinController.PreviousCatalogue(source, sale20));
    }
}
