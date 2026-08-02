using System.Text.RegularExpressions;
using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Market;

/// <summary>
/// Ports the original vanilla-JS Market Intelligence module (js/market.js) — import actual
/// post-sale auction prices, compare against this app's own valuations. Unlike the original,
/// which matched by raw lot number alone, matching here prefers (Broker, LotNumber) whenever
/// the actuals file has a detectable Broker column: lot numbers restart per broker within a
/// sale (confirmed against real data — every valued lot in two separately-checked catalogues
/// shared its lot number with 6+ other brokers), so LotNumber alone is ambiguous for nearly
/// every real lot, not just an edge case. When no Broker column is found, it falls back to the
/// original's LotNumber-only matching, but — same fix class as Phase 6's duplicate-lot
/// detection — a lot number that collides across brokers is excluded rather than silently
/// attributed to the wrong lot. See the Ambiguous count on Import/ImportStatus.
/// </summary>
[ApiController]
[Route("api/v1/market")]
[Authorize]
public class MarketController(ICatalogueSource source, MongoContext db, CatalogueImportService importer) : ControllerBase
{
    private static readonly string[] AllowedExtensions = ["xlsx", "xls", "csv"];
    private const long MaxUploadBytes = 10_000_000;

    private static readonly Regex LotColumnPattern = new("lot", RegexOptions.IgnoreCase);
    private static readonly Regex LotColumnExclude = new("selling", RegexOptions.IgnoreCase);
    private static readonly Regex PriceColumnPattern = new("actual|sold|final|hammer|price", RegexOptions.IgnoreCase);
    private static readonly Regex BrokerColumnPattern = new("broker", RegexOptions.IgnoreCase);

    private static readonly Dictionary<string, Func<Lot, string?>> BreakdownColumns = new()
    {
        ["broker"] = l => l.Broker,
        ["grade"] = l => l.Grade,
        ["elevation"] = l => l.Elevation,
    };

    [HttpPost("{catalogueId:guid}/import")]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<ImportActualsResultDto>> Import(Guid catalogueId, IFormFile file, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return NotFound();

        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!AllowedExtensions.Contains(ext))
            return BadRequest($"Unsupported file type: .{ext}. Allowed: {string.Join(", ", AllowedExtensions)}");

        await using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        ParsedCatalogue parsed;
        try
        {
            var rawRows = ext == "csv" ? importer.ParseCsv(buffer) : importer.ParseExcel(buffer);
            parsed = ExtractSimpleTable(rawRows);
        }
        catch (Exception ex)
        {
            return BadRequest($"Could not read that file: {ex.Message}");
        }

        var lotCol = parsed.Headers.FirstOrDefault(h => LotColumnPattern.IsMatch(h) && !LotColumnExclude.IsMatch(h)) ?? parsed.Headers.FirstOrDefault();
        var priceCol = parsed.Headers.FirstOrDefault(h => PriceColumnPattern.IsMatch(h))
            ?? parsed.Headers.FirstOrDefault(h =>
            {
                var vals = parsed.Rows.Select(r => r.GetValueOrDefault(h, "")).Where(v => !string.IsNullOrWhiteSpace(v)).ToList();
                return vals.Count > 0 && vals.All(v => decimal.TryParse(v.Replace(",", ""), out _));
            });
        var brokerCol = parsed.Headers.FirstOrDefault(h => BrokerColumnPattern.IsMatch(h));

        if (lotCol is null || priceCol is null)
            return BadRequest("Could not find a lot number and a price column in that file.");

        int matched = 0, unmatched = 0, ambiguous = 0;
        var toInsert = new List<ActualPrice>();
        var importedAt = DateTime.UtcNow;

        if (brokerCol is not null)
        {
            var priceMap = new Dictionary<(string Broker, string LotNumber), decimal>();
            foreach (var row in parsed.Rows)
            {
                var lotNumber = row.GetValueOrDefault(lotCol, "").Trim();
                var broker = row.GetValueOrDefault(brokerCol, "").Trim();
                if (lotNumber == "" || broker == "" || !decimal.TryParse(row.GetValueOrDefault(priceCol, "").Replace(",", ""), out var price)) continue;
                priceMap[(broker, lotNumber)] = price; // last value wins on an in-file duplicate
            }

            var withBroker = lots.Where(l => !string.IsNullOrWhiteSpace(l.LotNumber) && !string.IsNullOrWhiteSpace(l.Broker)).ToList();
            unmatched += lots.Count(l => !string.IsNullOrWhiteSpace(l.LotNumber) && string.IsNullOrWhiteSpace(l.Broker));

            foreach (var group in withBroker.GroupBy(l => (Broker: l.Broker!, LotNumber: l.LotNumber!)))
            {
                if (group.Count() > 1) { ambiguous += group.Count(); continue; }
                if (priceMap.TryGetValue(group.Key, out var price))
                {
                    matched++;
                    toInsert.Add(new ActualPrice { CatalogueId = catalogueId, Broker = group.Key.Broker, LotNumber = group.Key.LotNumber, Price = price, ImportedAt = importedAt });
                }
                else unmatched++;
            }
        }
        else
        {
            var priceMap = new Dictionary<string, decimal>();
            foreach (var row in parsed.Rows)
            {
                var lotNumber = row.GetValueOrDefault(lotCol, "").Trim();
                if (lotNumber == "" || !decimal.TryParse(row.GetValueOrDefault(priceCol, "").Replace(",", ""), out var price)) continue;
                priceMap[lotNumber] = price; // last value wins on an in-file duplicate, matching the original
            }

            foreach (var group in lots.Where(l => !string.IsNullOrWhiteSpace(l.LotNumber)).GroupBy(l => l.LotNumber!))
            {
                if (group.Count() > 1) { ambiguous += group.Count(); continue; }
                if (priceMap.TryGetValue(group.Key, out var price))
                {
                    matched++;
                    toInsert.Add(new ActualPrice { CatalogueId = catalogueId, LotNumber = group.Key, Price = price, ImportedAt = importedAt });
                }
                else unmatched++;
            }
        }

        await db.ActualPrices.DeleteManyAsync(p => p.CatalogueId == catalogueId, ct);
        if (toInsert.Count > 0) await db.ActualPrices.InsertManyAsync(toInsert, cancellationToken: ct);

        return Ok(new ImportActualsResultDto(file.FileName, matched, unmatched, ambiguous, importedAt));
    }

    [HttpGet("{catalogueId:guid}/import-status")]
    public async Task<ActionResult<ImportStatusDto>> ImportStatus(Guid catalogueId, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return NotFound();

        var actuals = await db.ActualPrices.Find(p => p.CatalogueId == catalogueId).ToListAsync(ct);
        if (actuals.Count == 0) return Ok(new ImportStatusDto(false, null, 0, 0, 0));

        int unmatched, ambiguous;
        if (actuals[0].Broker is not null)
        {
            var priced = actuals.Select(a => (a.Broker!, a.LotNumber)).ToHashSet();
            var withBroker = lots.Where(l => !string.IsNullOrWhiteSpace(l.LotNumber) && !string.IsNullOrWhiteSpace(l.Broker)).ToList();
            unmatched = lots.Count(l => !string.IsNullOrWhiteSpace(l.LotNumber) && string.IsNullOrWhiteSpace(l.Broker));
            var groups = withBroker.GroupBy(l => (Broker: l.Broker!, LotNumber: l.LotNumber!)).ToList();
            unmatched += groups.Count(g => g.Count() == 1 && !priced.Contains(g.Key));
            ambiguous = groups.Where(g => g.Count() > 1).Sum(g => g.Count());
        }
        else
        {
            var priced = actuals.Select(a => a.LotNumber).ToHashSet();
            var groups = lots.Where(l => !string.IsNullOrWhiteSpace(l.LotNumber)).GroupBy(l => l.LotNumber!).ToList();
            unmatched = groups.Count(g => g.Count() == 1 && !priced.Contains(g.Key));
            ambiguous = groups.Where(g => g.Count() > 1).Sum(g => g.Count());
        }

        return Ok(new ImportStatusDto(true, actuals.Max(a => a.ImportedAt), actuals.Count, unmatched, ambiguous));
    }

    [HttpGet("{catalogueId:guid}/overview")]
    public async Task<ActionResult<AccuracyOverviewDto>> Overview(Guid catalogueId, CancellationToken ct)
    {
        var pairs = await BuildPairs(catalogueId, ct);
        if (pairs is null) return NotFound();
        if (pairs.Count == 0) return Ok(new AccuracyOverviewDto(0, null, null, null, null, null, null));

        var diffs = pairs.Select(p => p.Actual - p.Est).ToList();
        var pctErrors = pairs.Select(p => PctError(p.Est, p.Actual)).ToList();
        var mape = pctErrors.Select(Math.Abs).Average();
        var rmse = (decimal)Math.Sqrt((double)diffs.Select(d => d * d).Average());

        return Ok(new AccuracyOverviewDto(
            pairs.Count,
            100 - mape,
            mape,
            rmse,
            diffs.Average(),
            diffs.Where(d => d > 0).DefaultIfEmpty(0).Sum(),
            diffs.Where(d => d < 0).DefaultIfEmpty(0).Sum()
        ));
    }

    [HttpGet("{catalogueId:guid}/breakdown/{column}")]
    public async Task<ActionResult<List<AccuracyBucketDto>>> Breakdown(Guid catalogueId, string column, CancellationToken ct)
    {
        if (!BreakdownColumns.TryGetValue(column, out var selector))
            return BadRequest($"Unknown breakdown column '{column}'.");

        var pairs = await BuildPairs(catalogueId, ct);
        if (pairs is null) return NotFound();

        var rows = pairs
            .Select(p => (Label: string.IsNullOrWhiteSpace(selector(p.Lot)) ? "(blank)" : selector(p.Lot)!, PctError: PctError(p.Est, p.Actual)))
            .GroupBy(x => x.Label)
            .Select(g => new AccuracyBucketDto(g.Key, g.Count(), g.Select(x => Math.Abs(x.PctError)).Average(), g.Average(x => x.PctError)))
            .OrderBy(b => b.Mape)
            .ToList();

        return Ok(rows);
    }

    [HttpGet("{catalogueId:guid}/insights")]
    public async Task<ActionResult<List<MarketInsightDto>>> Insights(Guid catalogueId, CancellationToken ct)
    {
        var pairs = await BuildPairs(catalogueId, ct);
        if (pairs is null) return NotFound();

        (string Dimension, Func<Lot, string?> Selector)[] dimensions =
        [
            ("Grade", l => l.Grade),
            ("Elevation", l => l.Elevation),
            ("Broker", l => l.Broker),
        ];

        var insights = new List<MarketInsightDto>();
        foreach (var (dimension, selector) in dimensions)
        {
            var buckets = pairs.Where(p => !string.IsNullOrWhiteSpace(selector(p.Lot))).GroupBy(p => selector(p.Lot)!);
            foreach (var bucket in buckets)
            {
                var diffs = bucket.Select(p => p.Actual - p.Est).ToList();
                if (diffs.Count < 3) continue;
                var avgDiff = diffs.Average();
                if (Math.Abs(avgDiff) < 1) continue;
                insights.Add(new MarketInsightDto(dimension, bucket.Key, diffs.Count, avgDiff, avgDiff < 0 ? "overvalued" : "undervalued", Math.Abs(avgDiff)));
            }
        }

        return Ok(insights.OrderByDescending(i => i.Magnitude).Take(6).ToList());
    }

    /// <summary>A minimal header+data split for the actuals file — no reuse of
    /// CatalogueImportService.ExtractTable, whose MinPopulatedCellsForDataRow=10 floor is
    /// calibrated for full 19+ column catalogue files and would drop every row of a 2-3
    /// column actuals file outright. Header = first row with 2+ non-blank cells; data = every
    /// following row with at least one non-blank cell.</summary>
    private static ParsedCatalogue ExtractSimpleTable(List<List<string>> rows)
    {
        var headerIdx = rows.FindIndex(r => r.Count(c => !string.IsNullOrWhiteSpace(c)) >= 2);
        if (headerIdx == -1) return new ParsedCatalogue();

        var headers = rows[headerIdx].Select((h, i) => string.IsNullOrWhiteSpace(h) ? $"Column {i + 1}" : h.Trim()).ToList();
        var data = rows.Skip(headerIdx + 1)
            .Where(r => r.Any(c => !string.IsNullOrWhiteSpace(c)))
            .Select(r =>
            {
                var obj = new Dictionary<string, string>();
                for (int i = 0; i < headers.Count; i++) obj[headers[i]] = i < r.Count ? r[i] : "";
                return obj;
            })
            .ToList();

        return new ParsedCatalogue { Headers = headers, Rows = data };
    }

    private static decimal PctError(decimal est, decimal actual) => est != 0 ? (actual - est) / est * 100 : 0;

    /// <summary>Lot + estimate + actual triples for lots with both a valuation and an imported
    /// actual price. All ActualPrice rows for a catalogue come from the same import, so they're
    /// either all Broker-keyed or all LotNumber-only — the mode is read off the first row.
    /// Every row already maps to a unique catalogue lot by construction (see Import above), so
    /// no ambiguity re-check is needed here.</summary>
    private async Task<List<(Lot Lot, decimal Est, decimal Actual)>?> BuildPairs(Guid catalogueId, CancellationToken ct)
    {
        var lots = source.GetLots(catalogueId);
        if (lots is null) return null;

        var overrides = (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync(ct))
            .ToDictionary(v => v.LotId, v => v.Valuation);
        var actualRows = await db.ActualPrices.Find(p => p.CatalogueId == catalogueId).ToListAsync(ct);
        var brokerAware = actualRows.Count > 0 && actualRows[0].Broker is not null;
        var byBrokerLot = brokerAware ? actualRows.ToDictionary(a => (a.Broker!, a.LotNumber), a => a.Price) : null;
        var byLotOnly = brokerAware ? null : actualRows.ToDictionary(a => a.LotNumber, a => a.Price);

        var pairs = new List<(Lot Lot, decimal Est, decimal Actual)>();
        foreach (var lot in lots)
        {
            if (string.IsNullOrWhiteSpace(lot.LotNumber)) continue;

            decimal? actual = brokerAware
                ? (!string.IsNullOrWhiteSpace(lot.Broker) && byBrokerLot!.TryGetValue((lot.Broker!, lot.LotNumber!), out var a1) ? a1 : null)
                : (byLotOnly!.TryGetValue(lot.LotNumber!, out var a2) ? a2 : null);
            if (actual is null) continue;

            var val = LotsController.Merged(lot, overrides);
            if (val?.EffectiveValue is null) continue;

            pairs.Add((lot, val.EffectiveValue.Value, actual.Value));
        }
        return pairs;
    }
}
