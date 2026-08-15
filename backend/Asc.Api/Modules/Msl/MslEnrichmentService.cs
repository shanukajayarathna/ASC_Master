using Asc.Api.Data;
using Asc.Api.Services;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Joins per-lot fields that only exist in the weekly sale Excel catalogues (bags,
/// per-bag packing) onto the MSL archive rows, matched on (broker, lot) within a sale —
/// the verified 99.7% join. Runs after imports for affected sales and once at startup for
/// any sale that has an Excel catalogue but no enrichment yet. Sales without an Excel
/// (pre-2026) simply keep null bags/packing.
/// </summary>
public class MslEnrichmentService(MongoContext db, ICatalogueSource catalogues, ILogger<MslEnrichmentService> logger)
{
    public async Task<int> EnrichAsync(IReadOnlyCollection<(int Year, int SaleNo)>? onlySales = null, CancellationToken ct = default)
    {
        var totalOps = 0;
        foreach (var cat in catalogues.ListCatalogues())
        {
            ct.ThrowIfCancellationRequested();
            // SourceName convention: "Sale {n} - {year}" (SaleFileStore).
            var m = System.Text.RegularExpressions.Regex.Match(cat.SourceName, @"^Sale (\d+) - (\d{4})$");
            if (!m.Success) continue;
            int saleNo = int.Parse(m.Groups[1].Value), year = int.Parse(m.Groups[2].Value);
            if (onlySales is not null && !onlySales.Contains((year, saleNo))) continue;

            // Skip already-enriched sales on the routine pass (a re-import wipes the
            // fields with the rows, so affected sales re-enrich naturally).
            if (onlySales is null &&
                await db.AuctionLots.Find(l => l.SaleYear == year && l.SaleNo == saleNo && l.PackingKg != null)
                    .Limit(1).AnyAsync(ct))
                continue;

            var excelLots = catalogues.GetLots(cat.Id);
            if (excelLots is null || excelLots.Count == 0) continue;

            var byKey = new Dictionary<(string Broker, string Lot), (int? Bags, decimal? Packing)>();
            foreach (var lot in excelLots)
            {
                if (lot.Broker is null || lot.LotNumber is null) continue;
                if (!MslBrokers.ExcelCodeToMslCode.TryGetValue(lot.Broker.Trim(), out var msl)) continue;
                // Lot.NetWeight holds the TOTAL weight (see CatalogueImportService's field
                // mapping); per-bag packing is the raw "Net Weight" column, with a
                // total/bags fallback.
                decimal? packing = null;
                if (lot.RawData.TryGetValue("Net Weight", out var raw) && decimal.TryParse(raw, out var perBag) && perBag > 0)
                    packing = perBag;
                else if (lot.NetWeight is > 0 && lot.Bags is > 0)
                    packing = Math.Round(lot.NetWeight.Value / lot.Bags.Value, 2);
                byKey[(msl, lot.LotNumber.Trim().TrimStart('0'))] = (lot.Bags, packing);
            }
            if (byKey.Count == 0) continue;

            var targets = await db.AuctionLots
                .Find(l => l.SaleYear == year && l.SaleNo == saleNo && !l.IsPrivate)
                .Project(l => new { l.Id, l.Broker, l.LotNo })
                .ToListAsync(ct);

            var ops = new List<WriteModel<AuctionLot>>();
            foreach (var t in targets)
            {
                if (t.Broker is null || !byKey.TryGetValue((t.Broker, t.LotNo), out var v)) continue;
                if (v.Bags is null && v.Packing is null) continue;
                ops.Add(new UpdateOneModel<AuctionLot>(
                    Builders<AuctionLot>.Filter.Eq(l => l.Id, t.Id),
                    Builders<AuctionLot>.Update.Set(l => l.Bags, v.Bags).Set(l => l.PackingKg, v.Packing)));
            }
            if (ops.Count > 0)
            {
                await db.AuctionLots.BulkWriteAsync(ops, new BulkWriteOptions { IsOrdered = false }, ct);
                totalOps += ops.Count;
                logger.LogInformation("MSL enrichment: sale {Sale}/{Year} — bags/packing set on {Count} lots",
                    saleNo, year, ops.Count);
            }
        }
        return totalOps;
    }
}
