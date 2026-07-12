using System.Text.RegularExpressions;
using Asc.Api.Models;
using ClosedXML.Excel;

namespace Asc.Api.Services;

public class ParsedCatalogue
{
    public List<string> Headers { get; set; } = new();
    public List<Dictionary<string, string>> Rows { get; set; } = new();
}

/// <summary>
/// Parses uploaded .xlsx/.xls/.csv catalogue files and builds Lot/Catalogue entities.
/// Mirrors the header-detection and column-classification heuristics from the original
/// browser-side implementation (extractTable / loadDataset in js/parsing.js + state.js),
/// now run server-side so the same file works regardless of client.
/// </summary>
public class CatalogueImportService
{
    private static readonly (string Field, Regex Match, Regex? Exclude)[] FieldPatterns =
    [
        ("LotNumber", new Regex("lot", RegexOptions.IgnoreCase), new Regex("selling", RegexOptions.IgnoreCase)),
        ("Broker", new Regex("broker", RegexOptions.IgnoreCase), null),
        ("Grade", new Regex("grade", RegexOptions.IgnoreCase), null),
        ("Garden", new Regex("garden", RegexOptions.IgnoreCase), null),
        ("Category", new Regex("categ", RegexOptions.IgnoreCase), null),
        ("Elevation", new Regex("elevat", RegexOptions.IgnoreCase), null),
        ("Region", new Regex("region", RegexOptions.IgnoreCase), null),
        ("Warehouse", new Regex("warehouse", RegexOptions.IgnoreCase), null),
        ("Mark", new Regex("mark", RegexOptions.IgnoreCase), new Regex("selling", RegexOptions.IgnoreCase)),
        ("SaleNo", new Regex("sale.?no", RegexOptions.IgnoreCase), null),
        ("SaleYear", new Regex("year", RegexOptions.IgnoreCase), null),
        ("InvoiceNo", new Regex("invoice", RegexOptions.IgnoreCase), null),
        ("NetWeight", new Regex("net.?(weight|wt)", RegexOptions.IgnoreCase), null),
        ("GrossWeight", new Regex("gross.?(weight|wt)", RegexOptions.IgnoreCase), null),
    ];

    public ParsedCatalogue ParseFile(Stream stream, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var rows = ext == ".csv" ? ParseCsv(stream) : ParseExcel(stream);
        return ExtractTable(rows);
    }

    private List<List<string>> ParseExcel(Stream stream)
    {
        using var wb = new XLWorkbook(stream);
        var ws = wb.Worksheets.First();
        var used = ws.RangeUsed();
        var result = new List<List<string>>();
        if (used is null) return result;
        foreach (var row in used.RowsUsed())
        {
            var cells = new List<string>();
            foreach (var cell in row.Cells(1, used.ColumnCount()))
                cells.Add(cell.GetFormattedString().Trim());
            result.Add(cells);
        }
        return result;
    }

    private List<List<string>> ParseCsv(Stream stream)
    {
        using var reader = new StreamReader(stream);
        var result = new List<List<string>>();
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            result.Add(SplitCsvLine(line));
        }
        return result;
    }

    private static List<string> SplitCsvLine(string line)
    {
        var fields = new List<string>();
        var cur = new System.Text.StringBuilder();
        bool inQuotes = false;
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (inQuotes)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                else if (c == '"') inQuotes = false;
                else cur.Append(c);
            }
            else
            {
                if (c == '"') inQuotes = true;
                else if (c == ',') { fields.Add(cur.ToString()); cur.Clear(); }
                else cur.Append(c);
            }
        }
        fields.Add(cur.ToString());
        return fields;
    }

    /// <summary>Finds the first row that looks like a header row (mostly non-empty, mostly text), same heuristic as the original client-side extractTable().</summary>
    private ParsedCatalogue ExtractTable(List<List<string>> rows)
    {
        int headerIdx = -1;
        int limit = Math.Min(rows.Count, 15);
        for (int i = 0; i < limit; i++)
        {
            var r = rows[i];
            var nonEmpty = r.Where(c => !string.IsNullOrWhiteSpace(c)).ToList();
            if (nonEmpty.Count < Math.Max(2, Math.Ceiling(r.Count * 0.4))) continue;
            var textLike = nonEmpty.Where(c => !decimal.TryParse(c.Replace(",", ""), out _)).ToList();
            if (nonEmpty.Count > 0 && (double)textLike.Count / nonEmpty.Count >= 0.6)
            {
                headerIdx = i;
                break;
            }
        }
        if (headerIdx == -1) return new ParsedCatalogue();

        var rawHeaders = rows[headerIdx];
        var seen = new Dictionary<string, int>();
        var headers = rawHeaders.Select((h, i) =>
        {
            var name = string.IsNullOrWhiteSpace(h) ? $"Column {i + 1}" : h.Trim();
            if (seen.TryGetValue(name, out var count))
            {
                seen[name] = count + 1;
                name = $"{name} ({count + 1})";
            }
            else seen[name] = 0;
            return name;
        }).ToList();

        var dataRows = rows.Skip(headerIdx + 1).Where(r => r.Any(c => !string.IsNullOrWhiteSpace(c))).ToList();
        var data = dataRows.Select(r =>
        {
            var obj = new Dictionary<string, string>();
            for (int i = 0; i < headers.Count; i++)
                obj[headers[i]] = i < r.Count ? r[i] : string.Empty;
            return obj;
        }).ToList();

        return new ParsedCatalogue { Headers = headers, Rows = data };
    }

    public Dictionary<string, ColumnMeta> BuildColumnMeta(List<string> headers, List<Dictionary<string, string>> data)
    {
        var visibleByDefault = new[] { "lot", "grade", "garden", "valuat", "class", "remark", "updated" }.Select(p => new Regex(p, RegexOptions.IgnoreCase)).ToList();
        var hiddenByDefault = new[] { "broker", "sale.?no", "sale.?year", "^year$", "mark", "invoice", "net.?weight", "gross.?weight", "categ", "stored", "warehouse", "elevat", "region", "date" }.Select(p => new Regex(p, RegexOptions.IgnoreCase)).ToList();

        var result = new Dictionary<string, ColumnMeta>();
        foreach (var h in headers)
        {
            var vals = data.Select(d => d.GetValueOrDefault(h, "")).Where(v => !string.IsNullOrWhiteSpace(v)).ToList();
            var numericCount = vals.Count(v => decimal.TryParse(v.Replace(",", ""), out _));
            bool numeric = vals.Count > 0 && (double)numericCount / vals.Count > 0.85;
            var uniq = vals.Select(v => v).Distinct().ToList();
            bool categorical = !numeric && uniq.Count > 0 && uniq.Count <= 60 && uniq.Count < data.Count * 0.6;
            result[h] = new ColumnMeta
            {
                Numeric = numeric,
                Categorical = categorical,
                Options = categorical ? uniq.OrderBy(x => x).ToList() : new List<string>(),
                DefaultVisible = visibleByDefault.Any(re => re.IsMatch(h)) && !hiddenByDefault.Any(re => re.IsMatch(h))
            };
        }
        return result;
    }

    public Lot BuildLot(Guid catalogueId, List<string> headers, Dictionary<string, string> row)
    {
        string? Find(string field)
        {
            var pattern = FieldPatterns.First(p => p.Field == field);
            var header = headers.FirstOrDefault(h => pattern.Match.IsMatch(h) && (pattern.Exclude is null || !pattern.Exclude.IsMatch(h)));
            return header is null ? null : row.GetValueOrDefault(header);
        }

        decimal? FindDecimal(string field)
        {
            var raw = Find(field);
            if (raw is null) return null;
            return decimal.TryParse(raw.Replace(",", ""), out var d) ? d : null;
        }

        var lotNumber = Find("LotNumber");
        var invoiceNo = Find("InvoiceNo");
        var rowKey = "k_" + Hash($"{lotNumber}|{invoiceNo}|{string.Join("|", headers.Select(h => row.GetValueOrDefault(h, "")))}");

        return new Lot
        {
            CatalogueId = catalogueId,
            RowKey = rowKey,
            LotNumber = lotNumber,
            Broker = Find("Broker"),
            Grade = Find("Grade"),
            Garden = Find("Garden"),
            Category = Find("Category"),
            Elevation = Find("Elevation"),
            Region = Find("Region"),
            Warehouse = Find("Warehouse"),
            Mark = Find("Mark"),
            SaleNo = Find("SaleNo"),
            SaleYear = Find("SaleYear"),
            InvoiceNo = invoiceNo,
            NetWeight = FindDecimal("NetWeight"),
            GrossWeight = FindDecimal("GrossWeight"),
            RawData = row
        };
    }

    private static string Hash(string s)
    {
        unchecked
        {
            int h = 0;
            foreach (var c in s) h = h * 31 + c;
            return ((uint)h).ToString("x");
        }
    }
}
