using System.Collections.Concurrent;
using Asc.Api.Data;
using Asc.Api.Modules.Reports;
using MongoDB.Driver;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Builds PDF and PowerPoint exports of the MSL archive for the Analytics Agent's
/// generate_pdf/generate_presentation tools — the deck/print-friendly counterparts to
/// MslExcelExportService's workbook. Deliberately separate from that service (own store, own
/// query) rather than refactored together: MslExcelExportService's Excel path is verified
/// figure-for-figure against the vendor portal, and this keeps that code untouched.
///
/// A deck/PDF is a human-readable overview, not a data dump — each dimension section is
/// capped at TopN rows (Excel already covers the full breakdown), and KPI figures round to
/// whole kg/Rs the same way the chat's own tables do.
/// </summary>
public class MslReportExportService(MongoContext db)
{
    public sealed record StoredExport(string FileName, byte[] Content, string ContentType, DateTime ExpiresAt);

    private readonly ConcurrentDictionary<string, StoredExport> _store = new();
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(20);
    private const int TopN = 12;

    public StoredExport? Get(string id)
    {
        Prune();
        return _store.TryGetValue(id, out var e) && e.ExpiresAt > DateTime.UtcNow ? e : null;
    }

    private void Prune()
    {
        foreach (var kv in _store)
            if (kv.Value.ExpiresAt <= DateTime.UtcNow)
                _store.TryRemove(kv.Key, out _);
    }

    public async Task<(string Id, string FileName)> GeneratePresentationAsync(int year, int? saleNo, CancellationToken ct)
    {
        var report = await BuildReportDto(year, saleNo, ct);
        var bytes = PresentationGenerator.Build(report);
        return Store(bytes, $"msl-analytics-{Scope(year, saleNo)}.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    }

    public async Task<(string Id, string FileName)> GeneratePdfAsync(int year, int? saleNo, CancellationToken ct)
    {
        var report = await BuildReportDto(year, saleNo, ct);
        var bytes = PdfReportGenerator.Build(report);
        return Store(bytes, $"msl-analytics-{Scope(year, saleNo)}.pdf", "application/pdf");
    }

    private static string Scope(int year, int? saleNo) => saleNo is null ? year.ToString() : $"{year}-sale{saleNo:00}";

    private (string Id, string FileName) Store(byte[] bytes, string fileName, string contentType)
    {
        Prune();
        var id = Guid.NewGuid().ToString("N");
        _store[id] = new StoredExport(fileName, bytes, contentType, DateTime.UtcNow.Add(Ttl));
        return (id, fileName);
    }

    private async Task<ReportDto> BuildReportDto(int year, int? saleNo, CancellationToken ct)
    {
        var fb = Builders<MslSaleStat>.Filter;
        var filter = fb.Eq(s => s.Year, year);
        if (saleNo is not null) filter &= fb.Eq(s => s.SaleNo, saleNo.Value);
        var stats = await db.MslSaleStats.Find(filter).ToListAsync(ct);
        if (stats.Count == 0)
            throw new InvalidOperationException($"No data for {(saleNo is null ? $"year {year}" : $"sale {saleNo} of {year}")}.");

        var total = stats.Where(s => s.Dimension == "total").ToList();
        var totalLots = total.Sum(s => s.Lots);
        var totalQty = total.Sum(s => s.TotalQtyKg);
        var totalSoldQty = total.Sum(s => s.SoldQtyKg);
        var totalValue = total.Sum(s => s.ProceedsRs);

        var scopeLabel = saleNo is null ? $"Year {year}" : $"Sale {saleNo:00} of {year}";

        var overview = new ReportSectionDto("Overview",
        [
            new KpiDto("Total lots", totalLots, "count"),
            new KpiDto("Sold lots", total.Sum(s => s.SoldLots), "count"),
            new KpiDto("Catalogued qty (kg)", Math.Round(totalQty, 0), "count"),
            new KpiDto("Sold qty (kg)", Math.Round(totalSoldQty, 0), "count"),
            new KpiDto("Proceeds (Rs)", Math.Round(totalValue, 0), "currency"),
            new KpiDto("Weighted avg (Rs/kg)", totalSoldQty > 0 ? Math.Round(totalValue / totalSoldQty, 2) : null, "currency"),
        ], null, null);

        ReportSectionDto? DimSection(string title, string dim, Func<string, string>? label = null)
        {
            var rows = stats.Where(s => s.Dimension == dim)
                .GroupBy(s => s.Key)
                .Select(g => new
                {
                    Key = g.Key,
                    Lots = (int)Math.Min(g.Sum(x => x.Lots), int.MaxValue),
                    Qty = g.Sum(x => x.TotalQtyKg),
                    SoldQty = g.Sum(x => x.SoldQtyKg),
                    Value = g.Sum(x => x.ProceedsRs),
                    Lbl = g.Select(x => x.Label).FirstOrDefault(l => l is not null),
                })
                .OrderByDescending(x => x.Qty).Take(TopN).ToList();
            if (rows.Count == 0) return null;

            var groups = rows.Select(r => new GroupRowDto(
                label?.Invoke(r.Key) ?? (r.Lbl is not null && r.Lbl != r.Key ? $"{r.Key} — {r.Lbl}" : r.Key),
                r.Lots,
                r.SoldQty > 0 ? Math.Round(r.Value / r.SoldQty, 2) : null,
                totalQty > 0 ? (double)Math.Round(r.Qty / totalQty * 100, 1) : null)).ToList();
            return new ReportSectionDto(title, null, "Name", groups);
        }

        string BrokerLabel(string key) => MslBrokers.CodeToName.TryGetValue(key, out var n)
            ? $"{MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => kv.Value == key).Key ?? key} — {n}"
            : key;

        var sections = new List<ReportSectionDto> { overview };
        foreach (var s in new[]
                 {
                     DimSection("Brokers", "broker", BrokerLabel),
                     DimSection("Grade Mix", "grade"),
                     DimSection("Elevations", "elevation"),
                     DimSection("Selling Marks", "mark"),
                     DimSection("Buyers", "buyer"),
                 })
            if (s is not null) sections.Add(s);

        return new ReportDto("msl-analytics", "MSL Analytics", scopeLabel, "ASC Intelligence Hub — MSL archive", DateTime.UtcNow, sections);
    }
}
