using System.Globalization;
using NPOI.SS.UserModel;
using NPOI.XSSF.Streaming;

namespace Asc.Api.Modules.Oklo;

/// <summary>Writes mapped OKLO lots as a "General Report" .xlsx — same two header rows and column
/// order as the hand-downloaded export, so SaleFileStore reads it like any other sale file.</summary>
public static class OkloSaleWriter
{
    // Columns the export stores as real numbers. Everything else (Invoice No "0227", codes,
    // dates, remarks) stays text so leading zeros survive.
    private static readonly HashSet<string> NumericHeaders = new(StringComparer.Ordinal)
    {
        "Lot No", "Bags", "Net Weight", "Total Weight", "Asking Price", "Baseline Price", "Registered Bid",
        "Second Highest Bid", "Total Price", "Purchased Price", "Final Price", Asc.Api.Services.SaleFileStore.AuctionItemIdHeader,
    };

    public static void Write(string path, IReadOnlyList<string[]> rows)
    {
        var top = OkloSaleMapper.TopHeaders;
        var sub = OkloSaleMapper.SubHeaders;
        // Numeric columns are decided by top header, plus the unnamed "Total Value" column.
        var numeric = new bool[top.Count];
        for (var i = 0; i < top.Count; i++) numeric[i] = NumericHeaders.Contains(top[i]);

        using var wb = new SXSSFWorkbook(200);
        var sheet = wb.CreateSheet("General Report");

        var r0 = sheet.CreateRow(0);
        for (var i = 0; i < top.Count; i++) if (top[i].Length > 0) r0.CreateCell(i).SetCellValue(top[i]);
        var r1 = sheet.CreateRow(1);
        for (var i = 0; i < sub.Count; i++) if (sub[i].Length > 0) r1.CreateCell(i).SetCellValue(sub[i]);

        for (var n = 0; n < rows.Count; n++)
        {
            var row = sheet.CreateRow(n + 2);
            var values = rows[n];
            for (var c = 0; c < values.Length; c++)
            {
                var v = values[c];
                if (v.Length == 0) continue;
                var cell = row.CreateCell(c);
                if ((numeric[c] || c == 48) && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                    cell.SetCellValue(d);
                else
                    cell.SetCellValue(v);
            }
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        using (var fs = File.Create(tmp)) wb.Write(fs);
        File.Move(tmp, path, overwrite: true);
    }
}
