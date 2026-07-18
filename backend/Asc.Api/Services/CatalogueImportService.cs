using System.Text.RegularExpressions;
using Asc.Api.Models;
using NPOI.SS.UserModel;

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
    // Each typed Lot field maps from the first header matching any of its patterns, tried
    // in order — so a preferred alias wins when a file carries both (the real weekly-sale
    // files have a per-bag "Net Weight" AND the lot's "Total Weight"; the total is what
    // the NetWeight field means, with the bare net pattern as fallback for older formats).
    private static readonly (string Field, Regex[] Matches, Regex? Exclude)[] FieldPatterns =
    [
        ("LotNumber", [new Regex("lot", RegexOptions.IgnoreCase)], new Regex("selling|outlot", RegexOptions.IgnoreCase)),
        ("Broker", [new Regex("broker", RegexOptions.IgnoreCase)], null),
        ("Grade", [new Regex("grade", RegexOptions.IgnoreCase)], null),
        ("Garden", [new Regex("garden", RegexOptions.IgnoreCase)], null),
        ("Category", [new Regex("categ", RegexOptions.IgnoreCase)], null),
        ("Elevation", [new Regex("elevat", RegexOptions.IgnoreCase)], null),
        ("Region", [new Regex("region", RegexOptions.IgnoreCase)], null),
        ("Warehouse", [new Regex("warehouse", RegexOptions.IgnoreCase)], null),
        ("Mark", [new Regex("mark", RegexOptions.IgnoreCase)], new Regex("selling", RegexOptions.IgnoreCase)),
        ("SaleNo", [new Regex("sale.?(no|number)", RegexOptions.IgnoreCase)], null),
        ("SaleYear", [new Regex("year", RegexOptions.IgnoreCase)], null),
        ("InvoiceNo", [new Regex("invoice", RegexOptions.IgnoreCase)], null),
        ("NetWeight", [new Regex("(total|nett).?(weight|wt)", RegexOptions.IgnoreCase), new Regex("net.?(weight|wt)", RegexOptions.IgnoreCase)], null),
        ("GrossWeight", [new Regex("gross.?(weight|wt)", RegexOptions.IgnoreCase)], null),
    ];

    public ParsedCatalogue ParseFile(Stream stream, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var rows = ext == ".csv" ? ParseCsv(stream) : ParseExcel(stream);
        return ExtractTable(rows);
    }

    /// <summary>
    /// Reads the first worksheet of an .xlsx (OOXML) or legacy .xls (BIFF/OLE2 — e.g. Crystal
    /// Reports exports) file. NPOI's WorkbookFactory auto-detects the format from the file's
    /// binary signature, so both work through the same code path.
    /// </summary>
    private List<List<string>> ParseExcel(Stream stream)
    {
        using var wb = WorkbookFactory.Create(stream);
        var sheet = wb.GetSheetAt(0);
        var result = new List<List<string>>();
        if (sheet is null || sheet.PhysicalNumberOfRows == 0) return result;

        var evaluator = wb.GetCreationHelper().CreateFormulaEvaluator();

        int maxCols = 0;
        for (int r = sheet.FirstRowNum; r <= sheet.LastRowNum; r++)
        {
            var row = sheet.GetRow(r);
            if (row is not null) maxCols = Math.Max(maxCols, row.LastCellNum);
        }
        if (maxCols <= 0) return result;

        for (int r = sheet.FirstRowNum; r <= sheet.LastRowNum; r++)
        {
            var row = sheet.GetRow(r);
            var cells = new List<string>(maxCols);
            for (int c = 0; c < maxCols; c++)
            {
                var cell = row?.GetCell(c, MissingCellPolicy.CREATE_NULL_AS_BLANK);
                cells.Add(CellToString(cell, evaluator).Trim());
            }
            result.Add(cells);
        }
        return result;
    }

    /// <summary>
    /// Reads a cell's value as plain text without NPOI's DataFormatter — that path pulls in a
    /// font-metrics dependency (SkiaSharp) that isn't bundled for cell-value-only parsing and
    /// throws FileNotFoundException on some cell formats. This covers the same cell types
    /// (blank/numeric/string/boolean/formula) using only the cell's raw typed value.
    /// </summary>
    private static string CellToString(ICell? cell, IFormulaEvaluator evaluator)
    {
        if (cell is null || cell.CellType == CellType.Blank) return string.Empty;
        try
        {
            if (cell.CellType == CellType.Formula)
            {
                var result = evaluator.Evaluate(cell);
                return result.CellType switch
                {
                    CellType.Numeric => FormatNumeric(cell, result.NumberValue),
                    CellType.String => result.StringValue ?? string.Empty,
                    CellType.Boolean => result.BooleanValue.ToString(),
                    _ => string.Empty,
                };
            }
            return cell.CellType switch
            {
                CellType.Numeric => FormatNumeric(cell, cell.NumericCellValue),
                CellType.String => cell.StringCellValue,
                CellType.Boolean => cell.BooleanCellValue.ToString(),
                _ => cell.ToString() ?? string.Empty,
            };
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string FormatNumeric(ICell cell, double value)
    {
        if (DateUtil.IsCellDateFormatted(cell))
            return DateUtil.GetJavaDate(value).ToString("yyyy-MM-dd");

        // Whole numbers print without a trailing ".0", matching how Excel displays plain numeric cells.
        return value == Math.Floor(value) && !double.IsInfinity(value)
            ? ((long)value).ToString(System.Globalization.CultureInfo.InvariantCulture)
            : value.ToString(System.Globalization.CultureInfo.InvariantCulture);
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

    private static readonly Regex[] VisibleByDefault = new string[]
    {
        "lot", "grade", "garden", "selling.?mark", "categ", "broker", "chest", "valuat", "class", "remark", "updated",
    }
        .Select(p => new Regex(p, RegexOptions.IgnoreCase)).ToArray();

    private static readonly Regex[] HiddenByDefault = new string[]
    {
        "sale.?no", "sale.?year", "^year$", "invoice", "gross.?weight", "stored", "warehouse", "elevat", "region", "date",
    }
        .Select(p => new Regex(p, RegexOptions.IgnoreCase)).ToArray();

    private static bool IsDefaultVisible(string header) =>
        VisibleByDefault.Any(re => re.IsMatch(header)) && !HiddenByDefault.Any(re => re.IsMatch(header));

    public Dictionary<string, ColumnMeta> BuildColumnMeta(List<string> headers, List<Dictionary<string, string>> data)
    {
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
                DefaultVisible = IsDefaultVisible(h)
            };
        }
        return result;
    }

    /// <summary>
    /// Re-applies the current default-visible-column heuristic to an already-imported
    /// catalogue's stored column metadata, so refinements to that heuristic take effect on
    /// existing catalogues without requiring a re-import.
    /// </summary>
    public Dictionary<string, ColumnMeta> RefreshDefaultVisibility(Dictionary<string, ColumnMeta> meta)
    {
        foreach (var (header, columnMeta) in meta)
            columnMeta.DefaultVisible = IsDefaultVisible(header);
        return meta;
    }

    public Lot BuildLot(Guid catalogueId, List<string> headers, Dictionary<string, string> row)
    {
        string? Find(string field)
        {
            var pattern = FieldPatterns.First(p => p.Field == field);
            foreach (var match in pattern.Matches)
            {
                var header = headers.FirstOrDefault(h => match.IsMatch(h) && (pattern.Exclude is null || !pattern.Exclude.IsMatch(h)));
                if (header is not null) return row.GetValueOrDefault(header);
            }
            return null;
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
            // Empty cells are dropped rather than stored — real market catalogues carry
            // ~50 columns, most sparse, and every consumer already treats a missing key
            // as blank. Cuts stored size dramatically at ~12k lots per weekly sale.
            RawData = row.Where(kv => !string.IsNullOrEmpty(kv.Value)).ToDictionary(kv => kv.Key, kv => kv.Value)
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
