using System.Text.RegularExpressions;
using Asc.Api.Controllers;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Asc.Api.Modules.Worksheet;

/// <summary>
/// The Worksheet's two ways to start a working table: pulled from a real sale (filtered by
/// broker + factory/MF code, scoped to one catalogue = one sale) or from a manually uploaded
/// Excel export — plus the export-back-to-Excel endpoint. Nothing here ever writes to
/// Lot/StoredValuation; every row lives only in the request/response and the browser's own
/// session, matching how the original standalone Worksheet tool worked (a rough pre-auction
/// scratchpad, not part of the persisted valuation record).
/// </summary>
[ApiController]
[Route("api/v1/worksheet")]
[Authorize]
public class WorksheetController(ICatalogueSource source, CatalogueImportService importer, WorksheetExcelBuilder excelBuilder) : ControllerBase
{
    private const int MaxLookupResults = 500;
    private const long MaxUploadBytes = 10_000_000;
    private static readonly string[] AllowedExtensions = ["xlsx", "xls", "csv"];

    [HttpGet("lots")]
    public ActionResult<WorksheetLookupResultDto> Lots(Guid catalogueId, string? broker, [FromQuery] string[]? factory)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return NotFound();

        IEnumerable<Lot> query = lots;
        if (!string.IsNullOrWhiteSpace(broker))
        {
            query = query.Where(l => l.Broker is not null && l.Broker.Contains(broker, StringComparison.OrdinalIgnoreCase));
        }
        var codes = (factory ?? []).Where(f => !string.IsNullOrWhiteSpace(f)).ToArray();
        if (codes.Length > 0)
        {
            // Any of the selected codes matches — Factory (the base MF code), FactoryName, or
            // Mark (the letter-suffixed sub-code, e.g. "MF0344B", for a specific line within
            // that factory — see MatchesFactoryCode below).
            query = query.Where(l => codes.Any(code => MatchesFactoryCode(l, code)));
        }

        var matched = query.ToList();
        var rows = matched.Take(MaxLookupResults).Select(ToRowDto).ToList();
        return Ok(new WorksheetLookupResultDto(rows, matched.Count, matched.Count > MaxLookupResults));
    }

    private static bool MatchesFactoryCode(Lot l, string code) =>
        (l.Factory is not null && l.Factory.Contains(code, StringComparison.OrdinalIgnoreCase)) ||
        (l.FactoryName is not null && l.FactoryName.Contains(code, StringComparison.OrdinalIgnoreCase)) ||
        (l.Mark is not null && l.Mark.Contains(code, StringComparison.OrdinalIgnoreCase));

    /// <summary>Distinct Broker/Factory values in one sale, for the "import from sale" panel's
    /// autocomplete — fetched once per sale selection, filtered client-side as the user types.</summary>
    [HttpGet("facets")]
    public ActionResult<WorksheetFacetsDto> Facets(Guid catalogueId)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return NotFound();

        var brokers = lots
            .Where(l => !string.IsNullOrWhiteSpace(l.Broker))
            .Select(l => l.Broker!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(b => b, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // The base MF code (Factory) and its letter-suffixed sub-codes (Mark, e.g. "MF0344B" —
        // a specific line within factory "MF0344") are both surfaced as separate, pickable
        // options, since a sale can carry lots under either form.
        var factories = lots
            .SelectMany(l => new[]
            {
                (Code: l.Factory, Name: l.FactoryName),
                (Code: l.Mark, Name: l.FactoryName),
            })
            .Where(f => !string.IsNullOrWhiteSpace(f.Code) || !string.IsNullOrWhiteSpace(f.Name))
            .Select(f => new WorksheetFactoryOptionDto(f.Code, f.Name))
            .Distinct()
            .OrderBy(f => f.Code, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Ok(new WorksheetFacetsDto(brokers, factories));
    }

    [HttpPost("import")]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<WorksheetImportResultDto>> Import(IFormFile file, CancellationToken ct)
    {
        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!AllowedExtensions.Contains(ext)) return BadRequest($"Unsupported file type: .{ext}. Allowed: {string.Join(", ", AllowedExtensions)}.");

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        ParsedCatalogue parsed;
        try
        {
            parsed = importer.ParseFile(buffer, file.FileName);
        }
        catch (Exception ex)
        {
            return BadRequest($"Could not read that file: {ex.Message}");
        }

        var (rows, skipped) = MapWorksheetRows(parsed);
        return Ok(new WorksheetImportResultDto(file.FileName, rows, skipped));
    }

    [HttpPost("export/excel")]
    public ActionResult ExportExcel(WorksheetExportRequestDto dto)
    {
        using var wb = excelBuilder.Build(
            dto.Title, dto.SaleLabel, dto.Rows, dto.ExcludeUnvalued, dto.ExtraColumnKeys ?? [],
            dto.ValuationLabel, dto.ProceedsLabel, dto.SheetName);
        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var fileName = $"{ExportController.SanitizeFileName(dto.Title)}.xlsx";
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
    }

    /// <summary>A blank starter workbook (headers + two sample rows) for filling in offline and
    /// re-uploading — same eight-column layout and sample values as the original standalone
    /// tools' downloadTemplate (script.js/asking-price.js), just built server-side with NPOI
    /// instead of client-side SheetJS since that's what's already wired up here. priceLabel lets
    /// the Asking Price tool ask for "Asking Price" instead of "Valuation" in the header row.</summary>
    [HttpGet("template")]
    public ActionResult Template([FromQuery] string priceLabel = "Valuation")
    {
        var headers = new[] { "Broker Lot No", "Invoice No", "Selling Mark", "Grade", "Net Weight", "Total Weight", priceLabel, "Remarks" };
        var sample = new object?[][]
        {
            ["1001", "INV-1001", "ABC", "BOP", 45, 46.5, null, null],
            ["1002", "INV-1002", "XYZ", "BOPF", 40, 41.2, null, null],
        };

        using var wb = new NPOI.XSSF.UserModel.XSSFWorkbook();
        var ws = wb.CreateSheet("Template");
        var headerRow = ws.CreateRow(0);
        for (var c = 0; c < headers.Length; c++)
        {
            headerRow.CreateCell(c).SetCellValue(headers[c]);
            ws.SetColumnWidth(c, 16 * 256);
        }
        for (var r = 0; r < sample.Length; r++)
        {
            var row = ws.CreateRow(r + 1);
            for (var c = 0; c < sample[r].Length; c++)
            {
                var cell = row.CreateCell(c);
                switch (sample[r][c])
                {
                    case int i: cell.SetCellValue(i); break;
                    case double d: cell.SetCellValue(d); break;
                    case string s: cell.SetCellValue(s); break;
                }
            }
        }

        using var ms = new MemoryStream();
        wb.Write(ms, leaveOpen: true);
        ms.Position = 0;
        var slug = ExportController.SanitizeFileName(priceLabel.ToLowerInvariant() == "asking price" ? "tea-asking-price-template" : "tea-auction-template");
        return File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{slug}.xlsx");
    }

    /// <summary>Builds the {value, rangeText} pair for a From/To pair exactly like the original
    /// standalone Worksheet's parseValuationInput: value is always the LOWER bound, rangeText is
    /// "lo.xx - hi.xx" (two decimals, spaced hyphen) regardless of which order From/To came in.</summary>
    private static (decimal Value, string RangeText) NormalizeRange(decimal a, decimal b)
    {
        var lo = Math.Min(a, b);
        var hi = Math.Max(a, b);
        return (lo, $"{lo:0.00} - {hi:0.00}");
    }

    private static WorksheetRowDto ToRowDto(Lot l)
    {
        // A lot valued as a range (From != To, no Single override) keeps that range visible —
        // EffectiveValue alone would silently collapse "1200-1300" down to "1250".
        var v = l.Valuation;
        var isRange = v is { ValuationSingle: null, ValuationFrom: not null, ValuationTo: not null } && v.ValuationFrom != v.ValuationTo;
        decimal? valuation = v?.EffectiveValue;
        string? rangeText = null;
        if (isRange)
        {
            (valuation, rangeText) = NormalizeRange(v!.ValuationFrom!.Value, v.ValuationTo!.Value);
        }

        Dictionary<string, string>? extra = null;
        if (!string.IsNullOrWhiteSpace(l.InvoiceNo)) (extra ??= new())["Invoice No"] = l.InvoiceNo!;

        return new WorksheetRowDto(
            l.LotNumber,
            l.Broker,
            l.SellingMark,
            l.Grade,
            l.Bags,
            GetRawDecimal(l, "Net Weight") ?? l.NetWeight,
            GetRawDecimal(l, "Total Weight") ?? l.NetWeight,
            valuation,
            rangeText,
            null,
            extra);
    }

    /// <summary>Lot.NetWeight actually resolves to the file's "Total Weight" column (see
    /// CatalogueImportService's own FieldPatterns comment) — the Worksheet wants both the
    /// per-bag Net Weight AND the lot's Total Weight as separate columns, so this reads them
    /// straight out of RawData (which keeps every original column regardless of what got
    /// promoted to a typed field) instead of relying on the typed NetWeight property alone.</summary>
    private static decimal? GetRawDecimal(Lot l, string headerLike)
    {
        var key = l.RawData.Keys.FirstOrDefault(k => k.Equals(headerLike, StringComparison.OrdinalIgnoreCase));
        if (key is null) return null;
        return decimal.TryParse(l.RawData[key].Replace(",", ""), out var d) ? d : null;
    }

    // Ported verbatim from the original standalone Worksheet tool's HEADER_ALIASES/
    // buildHeaderMap (script.js): each field's accepted header spellings, matched by exact
    // normalized text first, falling back to substring containment only if nothing matched
    // exactly — e.g. "Rate" doesn't accidentally win over an exact "Valuation" header.
    private static readonly Dictionary<string, string[]> HeaderAliases = new()
    {
        ["LotNumber"] = ["broker lot no", "lot no", "lot number", "lot", "broker lot number"],
        ["Broker"] = ["broker", "broker name", "broker code", "broker company"],
        ["SellingMark"] = ["selling mark", "mark", "seller mark", "s.mark", "invoice mark"],
        ["Grade"] = ["grade"],
        ["Bags"] = ["bags", "no of bags", "no. of bags", "bag count"],
        ["NetWeight"] = ["net weight", "net wt", "nett weight", "net wt.", "net weight (kg)"],
        ["TotalWeight"] = ["total weight", "total wt", "total weight (kg)", "gross weight", "weight"],
        // Also accepts the Asking Price tool's own header spellings, so a file exported from
        // either tool loads correctly on both (ported verbatim from the original standalone
        // apps, which cross-recognise "valuation" and "asking price" the same way).
        ["Valuation"] = ["valuation", "price", "rate", "valuation (rs)", "price/kg", "asking price", "asking", "ask price", "asking price (rs)", "ask"],
        ["Remarks"] = ["remarks", "remark", "comments", "comment", "notes", "note"],
    };

    // A row must carry all five of these to be usable — same REQUIRED_FIELDS list as the
    // original (Broker and Valuation are deliberately NOT required).
    private static readonly string[] RequiredFields = ["LotNumber", "SellingMark", "Grade", "NetWeight", "TotalWeight"];

    private static readonly Regex WhitespaceRun = new(@"\s+");
    private static string NormalizeHeader(string h) => WhitespaceRun.Replace(h.Trim().ToLowerInvariant(), " ");

    private static Dictionary<string, int> BuildHeaderMap(List<string> headers)
    {
        var normalized = headers.Select(NormalizeHeader).ToList();
        var map = new Dictionary<string, int>();
        foreach (var (field, aliases) in HeaderAliases)
        {
            var idx = normalized.FindIndex(aliases.Contains);
            if (idx == -1) idx = normalized.FindIndex(h => aliases.Any(h.Contains));
            map[field] = idx;
        }
        return map;
    }

    private static readonly Regex ValuationRangePattern = new(@"^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$");

    private static (List<WorksheetRowDto> Rows, int Skipped) MapWorksheetRows(ParsedCatalogue parsed)
    {
        var headerMap = BuildHeaderMap(parsed.Headers);

        string? Find(Dictionary<string, string> row, string field)
        {
            var idx = headerMap.GetValueOrDefault(field, -1);
            if (idx < 0) return null;
            var value = row.GetValueOrDefault(parsed.Headers[idx]);
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        decimal? FindDecimal(Dictionary<string, string> row, string field)
        {
            var raw = Find(row, field);
            return raw is not null && decimal.TryParse(raw.Replace(",", ""), out var d) ? d : null;
        }

        int? FindInt(Dictionary<string, string> row, string field)
        {
            var raw = Find(row, field);
            return raw is not null && int.TryParse(raw.Replace(",", ""), out var i) ? i : null;
        }

        // A cell like "1200-1300" fails a plain decimal parse — caught here so an uploaded
        // range valuation survives the import instead of silently becoming blank. Value is
        // always the LOWER bound, same as parseValuationInput in the original tool.
        (decimal? Valuation, string? RangeText) FindValuation(Dictionary<string, string> row)
        {
            var raw = Find(row, "Valuation");
            if (raw is null) return (null, null);
            var cleaned = raw.Replace(",", "").Trim();
            var rangeMatch = ValuationRangePattern.Match(cleaned);
            if (rangeMatch.Success)
            {
                var a = decimal.Parse(rangeMatch.Groups[1].Value);
                var b = decimal.Parse(rangeMatch.Groups[2].Value);
                var (value, rangeText) = NormalizeRange(a, b);
                return (value, rangeText);
            }
            return (decimal.TryParse(cleaned, out var d) ? d : null, null);
        }

        // Any header that didn't map to one of the eight known fields is an "extra" column the
        // user can add to the table via the Columns menu — same concept as the original tool's
        // extraDefs (script.js), just without its column-insertion-position logic.
        var usedIdx = new HashSet<int>(headerMap.Values.Where(i => i >= 0));
        var extraHeaders = parsed.Headers
            .Select((h, i) => (Header: h, Index: i))
            .Where(x => !usedIdx.Contains(x.Index) && !string.IsNullOrWhiteSpace(x.Header))
            .ToList();

        var rows = new List<WorksheetRowDto>();
        var skipped = 0;
        foreach (var row in parsed.Rows)
        {
            if (RequiredFields.Any(field => Find(row, field) is null))
            {
                skipped++;
                continue;
            }
            var (valuation, rangeText) = FindValuation(row);
            Dictionary<string, string>? extra = null;
            foreach (var (header, _) in extraHeaders)
            {
                var value = row.GetValueOrDefault(header);
                if (string.IsNullOrWhiteSpace(value)) continue;
                extra ??= [];
                extra[header] = value;
            }
            rows.Add(new WorksheetRowDto(
                Find(row, "LotNumber"), Find(row, "Broker"), Find(row, "SellingMark"), Find(row, "Grade"), FindInt(row, "Bags"),
                FindDecimal(row, "NetWeight"), FindDecimal(row, "TotalWeight"), valuation, rangeText, Find(row, "Remarks"), extra));
        }
        return (rows, skipped);
    }
}
