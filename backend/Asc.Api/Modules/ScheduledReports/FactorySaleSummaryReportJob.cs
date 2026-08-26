using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Msl;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Asc.Api.Modules.ScheduledReports;

/// <summary>
/// Generates the per-sale Factory Sale Summary — every estate's, and every plantation-group
/// owner's, quantity/average-price/unsold breakdown across each broker active in the sale,
/// plus a TOTAL column — the moment a sale closes. Shape mirrors WeeklyFactAutoReportJob: same
/// closed-sale detection (MslWeeklyReportService.FindRecentlyClosedSalesAsync), same
/// ExistsForSaleAsync idempotency, same SavedReport/IGeneratedReportFileStore output path.
/// Unlike Weekly FACT, everything this needs — AuctionLot's Broker/QuantityKg/PriceRs/Sold/
/// EstateName/FactoryCode, plus MslReferenceService's factory-to-plantation-group lookup for
/// the Owner-wise sheet — is already in the MSL archive, so a closed sale generates
/// immediately with no external upload/staging/grace-period step to wait on.
/// </summary>
public class FactorySaleSummaryReportJob(
    MslWeeklyReportService wesService,
    MongoContext db,
    MslReferenceService reference,
    IGeneratedReportFileStore fileStore,
    ISavedReportsService savedReports,
    ILogger<FactorySaleSummaryReportJob> logger) : IScheduledReportJob
{
    private static readonly TimeSpan LookbackWindow = TimeSpan.FromDays(21);

    public string Key => "factory-sale-summary";
    public string DisplayName => "Factory Sale Summary (Estate & Owner-wise)";
    public ReportJobTrigger Trigger => ReportJobTrigger.AfterSaleClose();
    public ReportJobCadence Cadence => ReportJobCadence.Weekly;

    public async Task<ScheduledReportJobRunResult> RunAsync(CancellationToken ct)
    {
        var closedSales = await wesService.FindRecentlyClosedSalesAsync(LookbackWindow, ct);
        if (closedSales.Count == 0) return ScheduledReportJobRunResult.Ok("No sales closed in the lookback window.");

        var generated = new List<string>();
        var failed = new List<string>();

        foreach (var (year, saleNo, saleDate) in closedSales)
        {
            if (await savedReports.ExistsForSaleAsync(Key, year, saleNo, ct)) continue;

            try
            {
                var savedId = await GenerateOneAsync(year, saleNo, saleDate, "Generated automatically on sale close", ct);
                generated.Add($"Sale {saleNo}/{year} (saved {savedId})");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Factory Sale Summary generation failed for sale {SaleNo}/{Year}", saleNo, year);
                failed.Add($"Sale {saleNo}/{year}: {ex.Message}");
            }
        }

        var summary = string.Join(" ", new[]
        {
            generated.Count > 0 ? $"Generated: {string.Join(", ", generated)}." : null,
            failed.Count > 0 ? $"Needs attention: {string.Join(", ", failed)}." : null,
        }.Where(s => s is not null));

        if (failed.Count > 0 && generated.Count == 0) return ScheduledReportJobRunResult.Failed(summary);
        return ScheduledReportJobRunResult.Ok(summary.Length > 0 ? summary : "Nothing new to generate.");
    }

    /// <summary>On-demand generation for one specific sale — the Reports page's own "Generate"
    /// button, for a sale a user wants a report for right now rather than waiting on RunAsync's
    /// own closed-sale scan (or re-checking one it already produced — this always regenerates
    /// fresh and adds a new SavedReport, the same "just run it again" behavior every other
    /// manual generate flow in this app has).</summary>
    public async Task<Guid> GenerateForSaleAsync(int year, int saleNo, CancellationToken ct)
    {
        var saleDate = await db.AuctionLots
            .Find(l => l.SaleYear == year && l.SaleNo == saleNo)
            .Project(l => l.SaleDate)
            .FirstOrDefaultAsync(ct);
        if (saleDate == default) throw new InvalidOperationException($"No lots found in the database for sale {saleNo}/{year}.");

        return await GenerateOneAsync(year, saleNo, saleDate, "Generated manually", ct);
    }

    private async Task<Guid> GenerateOneAsync(int year, int saleNo, DateTime saleDate, string source, CancellationToken ct)
    {
        var cells = await AggregateAsync(year, saleNo, ct);
        if (cells.Count == 0) throw new InvalidOperationException("No lots found in the database for this sale.");

        var bytes = FactorySaleSummaryWorkbookBuilder.Build(saleNo, year, saleDate, cells, reference);

        using var ms = new MemoryStream(bytes);
        var fileName = $"factory-sale-summary_sale{saleNo}_{year}.xlsx";
        var storedFileId = await fileStore.SaveAsync(
            ms, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ct);

        var report = await savedReports.SaveAsync(new SavedReport
        {
            Type = Key,
            Title = $"Factory Sale Summary — Sale {saleNo}/{year} ({saleDate:dd MMM yyyy})",
            SaleYear = year,
            SaleNo = saleNo,
            StoredFileId = storedFileId,
            Source = source,
        }, ct);

        return report.Id;
    }

    /// <summary>One (estate, factory, broker) cell: sold qty/value feed QTY/AVG, unsold qty
    /// feeds UN SLOD. Kept at factory granularity (not pre-summed to estate) so the Owner-wise
    /// sheet can re-fold by plantation group without a second database round trip.</summary>
    internal sealed record Cell(string Estate, string Factory, string Broker, decimal SoldQty, decimal SoldValue, decimal UnsoldQty);

    private async Task<List<Cell>> AggregateAsync(int year, int saleNo, CancellationToken ct)
    {
        var qtyPrice = new BsonDocument("$multiply", new BsonArray { "$q", "$p" });
        var stages = new List<BsonDocument>
        {
            new("$match", new BsonDocument { ["y"] = year, ["s"] = saleNo }),
            new("$group", new BsonDocument
            {
                ["_id"] = new BsonDocument { ["e"] = "$e", ["f"] = "$f", ["b"] = "$b" },
                ["soldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", "$q", 0 })),
                ["soldVal"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", qtyPrice, 0 })),
                ["unsoldQty"] = new BsonDocument("$sum", new BsonDocument("$cond", new BsonArray { "$so", 0, "$q" })),
            }),
        };

        var docs = await db.AuctionLots.Aggregate<BsonDocument>(stages, new AggregateOptions { AllowDiskUse = true }, ct).ToListAsync(ct);
        return docs.Select(d =>
        {
            var id = d["_id"].AsBsonDocument;
            string StrOrDefault(string field, string fallback) =>
                id.TryGetValue(field, out var v) && !v.IsBsonNull && v.AsString.Length > 0 ? v.AsString : fallback;

            return new Cell(
                StrOrDefault("e", "(Unknown estate)"),
                StrOrDefault("f", ""),
                StrOrDefault("b", "PVT"),
                d["soldQty"].ToDecimal(), d["soldVal"].ToDecimal(), d["unsoldQty"].ToDecimal());
        }).ToList();
    }
}
