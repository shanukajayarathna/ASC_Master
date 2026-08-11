using System.Text.RegularExpressions;
using Asc.Api.Controllers;
using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.AuctionReports;
using Asc.Api.Modules.MasterData;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Market;

/// <summary>
/// Compares this app's own valuations against real post-sale results. There are two sources of
/// "actual" price, checked in this order per lot:
///   1. A manually-uploaded actuals file (js/market.js's original design) — an explicit user
///      action, so it wins when present, e.g. a corrected/reconciled file.
///   2. Failing that, the sale file's own Status/PurchasedPrice/Buyer fields — settled sales
///      already carry real sold prices and buyers straight from the auction system (confirmed
///      against real data: e.g. Sale 1's file has Status=Sold rows with Purchased Price, Buyer,
///      Buyer Name filled in for every broker, not just ASC). This means accuracy metrics work
///      immediately for any settled sale with zero manual upload required — see IsFileSettled
///      and BuildPairs below.
/// Manual-upload matching prefers (Broker, LotNumber) whenever the actuals file has a detectable
/// Broker column: lot numbers restart per broker within a sale (confirmed against real data —
/// every valued lot in two separately-checked catalogues shared its lot number with 6+ other
/// brokers), so LotNumber alone is ambiguous for nearly every real lot, not just an edge case.
/// When no Broker column is found, it falls back to the original's LotNumber-only matching, but
/// — same fix class as Phase 6's duplicate-lot detection — a lot number that collides across
/// brokers is excluded rather than silently attributed to the wrong lot. See the Ambiguous count
/// on Import/ImportStatus.
/// </summary>
[ApiController]
[Route("api/v1/market")]
[Authorize]
public class MarketController(ICatalogueSource source, MongoContext db, CatalogueImportService importer, MasterDataResolver masterData) : ControllerBase
{
    private static readonly string[] AllowedExtensions = ["xlsx", "xls", "csv"];
    private const long MaxUploadBytes = 10_000_000;

    private static readonly Regex LotColumnPattern = new("lot", RegexOptions.IgnoreCase);
    private static readonly Regex LotColumnExclude = new("selling", RegexOptions.IgnoreCase);
    private static readonly Regex PriceColumnPattern = new("actual|sold|final|hammer|price", RegexOptions.IgnoreCase);
    private static readonly Regex BrokerColumnPattern = new("broker", RegexOptions.IgnoreCase);

    /// <summary>Internal, not private — Modules/Assistant reuses this selector map so the
    /// get_valuation_accuracy tool's breakdown option stays in lockstep with this endpoint.
    /// A method rather than a static field since the selectors resolve through a
    /// MasterDataResolver instance (admin-curated spelling aliases merge into one bucket
    /// instead of splitting it) — cheap to rebuild, only 3 entries.</summary>
    internal static Dictionary<string, Func<Lot, string?>> BreakdownColumns(MasterDataResolver masterData) => new()
    {
        ["broker"] = l => masterData.Resolve(MasterDataEntityType.Broker, l.Broker),
        ["grade"] = l => masterData.Resolve(MasterDataEntityType.Grade, l.Grade),
        ["elevation"] = l => masterData.Resolve(MasterDataEntityType.Elevation, l.Elevation),
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

        var fileEmbeddedMatched = lots.Count(IsFileSettled);

        var actuals = await db.ActualPrices.Find(p => p.CatalogueId == catalogueId).ToListAsync(ct);
        if (actuals.Count == 0) return Ok(new ImportStatusDto(false, null, 0, 0, 0, fileEmbeddedMatched));

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

        return Ok(new ImportStatusDto(true, actuals.Max(a => a.ImportedAt), actuals.Count, unmatched, ambiguous, fileEmbeddedMatched));
    }

    [HttpGet("{catalogueId:guid}/overview")]
    public async Task<ActionResult<AccuracyOverviewDto>> Overview(Guid catalogueId, CancellationToken ct)
    {
        var pairs = await BuildPairs(source, db, catalogueId, ct);
        if (pairs is null) return NotFound();
        return Ok(ComputeAccuracy(pairs));
    }

    [HttpGet("{catalogueId:guid}/breakdown/{column}")]
    public async Task<ActionResult<List<AccuracyBucketDto>>> Breakdown(Guid catalogueId, string column, CancellationToken ct)
    {
        if (!BreakdownColumns(masterData).TryGetValue(column, out var selector))
            return BadRequest($"Unknown breakdown column '{column}'.");

        var pairs = await BuildPairs(source, db, catalogueId, ct);
        if (pairs is null) return NotFound();

        return Ok(ComputeBreakdown(pairs, selector));
    }

    [HttpGet("{catalogueId:guid}/insights")]
    public async Task<ActionResult<List<MarketInsightDto>>> Insights(Guid catalogueId, CancellationToken ct)
    {
        var pairs = await BuildPairs(source, db, catalogueId, ct);
        if (pairs is null) return NotFound();

        return Ok(ComputeInsights(pairs, masterData));
    }

    /// <summary>Pure MAPE/RMSE/bias computation over already-built pairs — internal so the AI
    /// assistant's get_valuation_accuracy tool can reuse it without re-deriving the math.</summary>
    internal static AccuracyOverviewDto ComputeAccuracy(List<(Lot Lot, decimal Est, decimal Actual)> pairs)
    {
        if (pairs.Count == 0) return new AccuracyOverviewDto(0, null, null, null, null, null, null);

        var diffs = pairs.Select(p => p.Actual - p.Est).ToList();
        var pctErrors = pairs.Select(p => PctError(p.Est, p.Actual)).ToList();
        var mape = pctErrors.Select(Math.Abs).Average();
        var rmse = (decimal)Math.Sqrt((double)diffs.Select(d => d * d).Average());

        return new AccuracyOverviewDto(
            pairs.Count,
            100 - mape,
            mape,
            rmse,
            diffs.Average(),
            diffs.Where(d => d > 0).DefaultIfEmpty(0).Sum(),
            diffs.Where(d => d < 0).DefaultIfEmpty(0).Sum()
        );
    }

    /// <summary>Internal so the AI assistant's get_valuation_accuracy tool can reuse the same
    /// grouped MAPE/bias breakdown this endpoint returns.</summary>
    internal static List<AccuracyBucketDto> ComputeBreakdown(List<(Lot Lot, decimal Est, decimal Actual)> pairs, Func<Lot, string?> selector) =>
        pairs
            .Select(p => (Label: string.IsNullOrWhiteSpace(selector(p.Lot)) ? "(blank)" : selector(p.Lot)!, PctError: PctError(p.Est, p.Actual)))
            .GroupBy(x => x.Label)
            .Select(g => new AccuracyBucketDto(g.Key, g.Count(), g.Select(x => Math.Abs(x.PctError)).Average(), g.Average(x => x.PctError)))
            .OrderBy(b => b.Mape)
            .ToList();

    /// <summary>Internal so the AI assistant's get_market_insights tool can reuse the same
    /// over/under-valued findings this endpoint returns.</summary>
    internal static List<MarketInsightDto> ComputeInsights(List<(Lot Lot, decimal Est, decimal Actual)> pairs, MasterDataResolver masterData)
    {
        (string Dimension, Func<Lot, string?> Selector)[] dimensions =
        [
            ("Grade", l => masterData.Resolve(MasterDataEntityType.Grade, l.Grade)),
            ("Elevation", l => masterData.Resolve(MasterDataEntityType.Elevation, l.Elevation)),
            ("Broker", l => masterData.Resolve(MasterDataEntityType.Broker, l.Broker)),
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

        return insights.OrderByDescending(i => i.Magnitude).Take(6).ToList();
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

    internal static decimal PctError(decimal est, decimal actual) => est != 0 ? (actual - est) / est * 100 : 0;

    /// <summary>A lot counts as having a real, file-embedded actual price once the sale file
    /// itself marks it Sold and carries a PurchasedPrice — reuses TopPriceEngine.IsSold rather
    /// than a naive Status=="Sold" check so Status-string normalization (case, "SLD" etc.) stays
    /// in exactly one place across the app.</summary>
    private static bool IsFileSettled(Lot lot) => TopPriceEngine.IsSold(lot) && lot.PurchasedPrice.HasValue;

    /// <summary>Lot + estimate + actual triples for lots with a valuation and a real actual
    /// price. Two sources per lot, checked in order — see this class's doc comment: a manually
    /// uploaded ActualPrice (explicit user action, wins if present) or, failing that, the sale
    /// file's own PurchasedPrice for an already-settled lot. All ActualPrice rows for a
    /// catalogue come from the same import, so they're either all Broker-keyed or all
    /// LotNumber-only — the mode is read off the first row. Every row already maps to a unique
    /// catalogue lot by construction (see Import above), so no ambiguity re-check is needed
    /// here. Internal, not private/instance-bound — the AI assistant's market tools reuse this
    /// without duplicating the matching logic.</summary>
    internal static async Task<List<(Lot Lot, decimal Est, decimal Actual)>?> BuildPairs(ICatalogueSource source, MongoContext db, Guid catalogueId, CancellationToken ct)
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
            actual ??= IsFileSettled(lot) ? lot.PurchasedPrice : null;
            if (actual is null) continue;

            var val = LotsController.Merged(lot, overrides);
            if (val?.EffectiveValue is null) continue;

            pairs.Add((lot, val.EffectiveValue.Value, actual.Value));
        }
        return pairs;
    }
}
