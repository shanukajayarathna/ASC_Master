using System.Collections.Concurrent;
using Asc.Api.Data;
using MongoDB.Driver;
using NPOI.SS.UserModel;
using NPOI.XSSF.UserModel;

namespace Asc.Api.Modules.Msl;

/// <summary>
/// Builds Excel workbooks (NPOI — the project's spreadsheet library) from the MSL archive
/// for the Analytics Agent's generate_excel tool. Workbooks are held in memory under a
/// one-time id for a short window; the download endpoint streams them out. Rollup-backed
/// (mslSaleStats), so generation is fast even for whole-year scopes; invoice lines come
/// from a capped auctionLots query when a single sale is exported.
/// </summary>
public class MslExcelExportService(MongoContext db)
{
    public sealed record StoredExport(string FileName, byte[] Content, DateTime ExpiresAt);

    private readonly ConcurrentDictionary<string, StoredExport> _store = new();
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(20);
    private const int MaxLineRows = 3000;

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

    public async Task<(string Id, string FileName, List<string> Sheets)> GenerateAsync(
        int year, int? saleNo, CancellationToken ct)
    {
        var fb = Builders<MslSaleStat>.Filter;
        var filter = fb.Eq(s => s.Year, year);
        if (saleNo is not null) filter &= fb.Eq(s => s.SaleNo, saleNo.Value);
        var stats = await db.MslSaleStats.Find(filter).ToListAsync(ct);
        if (stats.Count == 0)
            throw new InvalidOperationException($"No data for {(saleNo is null ? $"year {year}" : $"sale {saleNo} of {year}")}.");

        Dictionary<string, (long Lots, long Sold, decimal Qty, decimal SoldQty, decimal Value)> Dim(string d) =>
            stats.Where(s => s.Dimension == d)
                .GroupBy(s => s.Key)
                .ToDictionary(g => g.Key, g => (
                    g.Sum(x => x.Lots), g.Sum(x => x.SoldLots), g.Sum(x => x.TotalQtyKg),
                    g.Sum(x => x.SoldQtyKg), g.Sum(x => x.ProceedsRs)));

        var labels = stats.Where(s => s.Label != null)
            .GroupBy(s => (s.Dimension, s.Key))
            .ToDictionary(g => g.Key, g => g.First().Label!);

        var total = Dim("total")["all"];
        var scope = saleNo is null ? $"Year {year}" : $"Sale {saleNo:00} of {year}";

        var wb = new XSSFWorkbook();
        var sheets = new List<string>();

        // Shared styles.
        var headerStyle = wb.CreateCellStyle();
        var headerFont = wb.CreateFont();
        headerFont.IsBold = true;
        headerFont.Color = NPOI.HSSF.Util.HSSFColor.White.Index;
        headerStyle.SetFont(headerFont);
        headerStyle.FillForegroundColor = NPOI.HSSF.Util.HSSFColor.DarkBlue.Index;
        headerStyle.FillPattern = FillPattern.SolidForeground;
        var numStyle = wb.CreateCellStyle();
        numStyle.DataFormat = wb.CreateDataFormat().GetFormat("#,##0.00");
        var boldStyle = wb.CreateCellStyle();
        var boldFont = wb.CreateFont();
        boldFont.IsBold = true;
        boldStyle.SetFont(boldFont);

        void Header(ISheet ws, params string[] cols)
        {
            var row = ws.CreateRow(0);
            for (int c = 0; c < cols.Length; c++)
            {
                var cell = row.CreateCell(c);
                cell.SetCellValue(cols[c]);
                cell.CellStyle = headerStyle;
            }
            ws.CreateFreezePane(0, 1);
        }

        void Num(IRow row, int col, double v)
        {
            var cell = row.CreateCell(col);
            cell.SetCellValue(v);
            cell.CellStyle = numStyle;
        }

        // ---- Summary ----
        var sum = wb.CreateSheet("Summary");
        sheets.Add("Summary");
        var title = sum.CreateRow(0).CreateCell(0);
        title.SetCellValue("ASC Intelligence Hub — MSL Analytics Export");
        title.CellStyle = boldStyle;
        sum.CreateRow(1).CreateCell(0).SetCellValue(scope);
        sum.CreateRow(2).CreateCell(0).SetCellValue($"Generated {DateTime.Now:yyyy-MM-dd HH:mm}");
        (string K, double V)[] kpis =
        [
            ("Total lots", total.Lots),
            ("Sold lots", total.Sold),
            ("Catalogued qty (kg)", (double)total.Qty),
            ("Sold qty (kg)", (double)total.SoldQty),
            ("Proceeds (Rs)", (double)total.Value),
            ("Weighted avg (Rs/kg)", total.SoldQty > 0 ? (double)Math.Round(total.Value / total.SoldQty, 2) : 0),
        ];
        for (int i = 0; i < kpis.Length; i++)
        {
            var row = sum.CreateRow(4 + i);
            row.CreateCell(0).SetCellValue(kpis[i].K);
            Num(row, 1, kpis[i].V);
        }
        sum.SetColumnWidth(0, 26 * 256);
        sum.SetColumnWidth(1, 18 * 256);

        void DimSheet(string sheetTitle, string dim, Func<string, string>? keyLabel = null)
        {
            var data = Dim(dim);
            if (data.Count == 0) return;
            var ws = wb.CreateSheet(sheetTitle);
            sheets.Add(sheetTitle);
            Header(ws, sheetTitle, "Lots", "Sold lots", "Qty (kg)", "Sold qty (kg)", "Proceeds (Rs)", "Avg (Rs/kg)", "% of qty");
            int r = 1;
            foreach (var (key, v) in data.OrderByDescending(kv => kv.Value.Qty))
            {
                var label = keyLabel?.Invoke(key)
                    ?? (labels.TryGetValue((dim, key), out var l) && l != key ? $"{key} — {l}" : key);
                var row = ws.CreateRow(r++);
                row.CreateCell(0).SetCellValue(label);
                row.CreateCell(1).SetCellValue(v.Lots);
                row.CreateCell(2).SetCellValue(v.Sold);
                Num(row, 3, (double)Math.Round(v.Qty, 2));
                Num(row, 4, (double)Math.Round(v.SoldQty, 2));
                Num(row, 5, (double)Math.Round(v.Value, 2));
                Num(row, 6, v.SoldQty > 0 ? (double)Math.Round(v.Value / v.SoldQty, 2) : 0);
                Num(row, 7, total.Qty > 0 ? (double)Math.Round(v.Qty / total.Qty * 100, 2) : 0);
            }
            ws.SetColumnWidth(0, 34 * 256);
            for (int c = 1; c <= 7; c++) ws.SetColumnWidth(c, 15 * 256);
        }

        string BrokerLabel(string key) =>
            MslBrokers.CodeToName.TryGetValue(key, out var n)
                ? $"{MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => kv.Value == key).Key ?? key} — {n}"
                : key;

        DimSheet("Brokers", "broker", BrokerLabel);
        DimSheet("Grade Mix", "grade");
        DimSheet("Elevations", "elevation");
        DimSheet("Buyers", "buyer");
        DimSheet("Selling Marks", "mark");
        DimSheet("Price Ranges", "priceRange");

        // ---- Invoice lines (single-sale scope only; capped) ----
        if (saleNo is not null)
        {
            var lots = await db.AuctionLots
                .Find(l => l.SaleYear == year && l.SaleNo == saleNo.Value)
                .Limit(MaxLineRows + 1)
                .ToListAsync(ct);
            var ws = wb.CreateSheet("Invoice Lines");
            sheets.Add("Invoice Lines");
            Header(ws, "Broker", "Lot", "Invoice", "Mark", "Grade", "Category", "Qty (kg)", "Price (Rs)", "Status", "Buyer", "Bags", "Packing");
            int r = 1;
            foreach (var l in lots.Take(MaxLineRows)
                         .OrderBy(l => l.Broker).ThenBy(l => int.TryParse(l.LotNo, out var n) ? n : int.MaxValue))
            {
                var row = ws.CreateRow(r++);
                var shortCode = l.Broker is not null
                    ? MslBrokers.ExcelCodeToMslCode.FirstOrDefault(kv => kv.Value == l.Broker).Key ?? l.Broker
                    : "";
                row.CreateCell(0).SetCellValue(shortCode);
                row.CreateCell(1).SetCellValue(l.LotNo);
                row.CreateCell(2).SetCellValue(l.Invoice ?? "");
                row.CreateCell(3).SetCellValue(l.SellingMark);
                row.CreateCell(4).SetCellValue(l.Grade);
                row.CreateCell(5).SetCellValue(l.IsPrivate ? "**PRIVATE SALE**" : l.SaleCategory ?? MslClassification.Classify(l.Grade).Category);
                Num(row, 6, (double)l.QuantityKg);
                Num(row, 7, (double)l.PriceRs);
                row.CreateCell(8).SetCellValue(l.OkloStatus ?? (l.Sold ? "SOLD" : "UNSOLD"));
                row.CreateCell(9).SetCellValue(l.BuyerName ?? l.BuyerCode ?? "");
                if (l.Bags is not null) row.CreateCell(10).SetCellValue(l.Bags.Value);
                if (l.PackingKg is not null) Num(row, 11, (double)l.PackingKg.Value);
            }
            if (lots.Count > MaxLineRows)
                ws.CreateRow(r).CreateCell(0).SetCellValue($"(truncated at {MaxLineRows} rows)");
            ws.SetColumnWidth(3, 26 * 256);
            ws.SetColumnWidth(9, 26 * 256);
        }

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: false);
        var id = Guid.NewGuid().ToString("N");
        var fileName = $"msl-analytics-{(saleNo is null ? year.ToString() : $"{year}-sale{saleNo:00}")}.xlsx";
        Prune();
        _store[id] = new StoredExport(fileName, ms.ToArray(), DateTime.UtcNow.Add(Ttl));
        return (id, fileName, sheets);
    }
}
