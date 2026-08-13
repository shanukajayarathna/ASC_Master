using Asc.Api.Models;
using Asc.Api.Modules.Agents;
using Asc.Api.Services;

namespace Asc.Api.Tests;

public class AgentContextTests
{
    private sealed class FakeCatalogueSource(params Catalogue[] catalogues) : ICatalogueSource
    {
        public IReadOnlyList<Catalogue> ListCatalogues() => catalogues;
        public Catalogue? GetCatalogue(Guid id) => catalogues.FirstOrDefault(c => c.Id == id);
        public IReadOnlyList<Lot>? GetLots(Guid catalogueId) => null;
        public (Lot Lot, Catalogue Catalogue)? FindLot(Guid lotId) => null;
        public IReadOnlyList<ValuedLotSlim> GetValuedSlim(Guid catalogueId) => [];
    }

    private static readonly Guid SaleId = Guid.NewGuid();
    private static readonly FakeCatalogueSource Source = new(new Catalogue { Id = SaleId, SourceName = "Sale 30 - 2026" });

    [Fact]
    public void NoActiveCatalogue_ReturnsNull()
    {
        Assert.Null(AgentContext.ActiveSaleLine(Source, null));
    }

    [Fact]
    public void NoCatalogueSource_ReturnsNull()
    {
        // Agents constructed without a source (tests, minimal setups) must not throw.
        Assert.Null(AgentContext.ActiveSaleLine(null, SaleId));
    }

    [Fact]
    public void UnknownCatalogueId_ReturnsNull()
    {
        // A stale id (sale file removed since the client loaded) silently drops the line
        // rather than grounding "current sale" to something that doesn't exist.
        Assert.Null(AgentContext.ActiveSaleLine(Source, Guid.NewGuid()));
    }

    [Fact]
    public void KnownCatalogue_NamesTheSaleAndItsId()
    {
        var line = AgentContext.ActiveSaleLine(Source, SaleId);
        Assert.NotNull(line);
        Assert.Contains("Sale 30 - 2026", line);
        Assert.Contains(SaleId.ToString(), line);
        // The whole point: the model must be told to use the id, not ask for one.
        Assert.Contains("do not ask the user for a catalogue id", line);
    }

    [Fact]
    public void NewestSaleWithOlderOnes_AlsoNamesThePreviousSale()
    {
        var prevId = Guid.NewGuid();
        var source = new FakeCatalogueSource(
            new Catalogue { Id = SaleId, SourceName = "Sale 30 - 2026" },
            new Catalogue { Id = prevId, SourceName = "Sale 29 - 2026" });

        var line = AgentContext.ActiveSaleLine(source, SaleId);
        Assert.NotNull(line);
        Assert.Contains("Sale 29 - 2026", line);
        Assert.Contains(prevId.ToString(), line);
    }

    [Fact]
    public void OldestSale_HasNoPreviousSaleLine()
    {
        // Selecting the oldest sale on record: no previous exists, and the line must not
        // pretend one does.
        var line = AgentContext.ActiveSaleLine(Source, SaleId);
        Assert.NotNull(line);
        Assert.DoesNotContain("previous sale is", line);
    }
}
