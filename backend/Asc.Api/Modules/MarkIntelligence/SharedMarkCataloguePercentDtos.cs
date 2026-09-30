namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>One factory's catalogued quantity split by broker, for the Shared Mark Catalogues %
/// Broker-wise report. QtyByBroker/PercentByBroker only ever carry brokers that actually
/// catalogued this factory in the selected scope — a broker with zero simply has no key, rather
/// than an explicit 0, so the frontend can tell "catalogued nothing" apart from "genuinely a
/// zero-weight lot" without a second flag.</summary>
public record SharedMarkCataloguePercentRowDto(
    string Code,
    string FactoryName,
    Dictionary<string, decimal> QtyByBroker,
    Dictionary<string, decimal> PercentByBroker,
    decimal TotalQty);

/// <summary>Brokers is every broker that appears in at least one row, in no particular order —
/// the frontend orders/colors columns off its own canonical broker list (frontend/src/lib/brokers.ts)
/// and simply ignores any code here it doesn't recognize.</summary>
public record SharedMarkCataloguePercentDto(
    List<string> Brokers,
    List<SharedMarkCataloguePercentRowDto> Rows);

/// <summary>One sale, for the report's own Sale/Range picker — mirrors SalePicker.tsx's own
/// "Sale N - YYYY" source name, pre-parsed so the frontend doesn't need its own regex.</summary>
public record SharedMarkCataloguePercentSaleDto(Guid CatalogueId, int Year, int SaleNo, string SourceName, DateTime ImportedAt);
