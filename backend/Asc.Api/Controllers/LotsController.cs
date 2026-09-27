using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Asc.Api.Modules.Oklo;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

/// <summary>
/// Lots come from the file-backed catalogue source; the database contributes only the
/// user-entered valuation overlay, which always wins over a valuation derived from the
/// sale file (the company's Valuation column + backfilled classification).
/// Requires login — this is the core commercial dataset (including PrivateNotes/BrokerNotes)
/// plus the valuation-mutation endpoints; see the security-audit note on CataloguesController.
/// </summary>
[ApiController]
[Route("api")]
[Authorize]
public class LotsController(ICatalogueSource source, ILiveCatalogueSource liveSource, MongoContext db) : ControllerBase
{
    [HttpGet("catalogues/{catalogueId:guid}/lots")]
    public async Task<ActionResult<PagedLotsDto>> GetLots(
        Guid catalogueId,
        [FromQuery] string? search,
        [FromQuery] string? status,
        [FromQuery] string? broker,
        [FromQuery] string? grade,
        [FromQuery] string? category,
        [FromQuery] string? garden,
        [FromQuery] string sortKey = "LotNumber",
        [FromQuery] int sortDir = 1,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] int? after = null,
        [FromQuery] string? knownVersion = null)
    {
        var (lots, snap) = await ResolveLotsAsync(catalogueId);
        if (lots is null) return await liveSource.IsLiveAsync(catalogueId) ? SaleLoading() : NotFound();

        // Cheap freshness poll: the client says which version it holds; if the sale hasn't been
        // refreshed since, answer without sending a single lot.
        if (snap is { Complete: true, FetchedAtUtc: { } fetched } && knownVersion == fetched.ToString("O"))
            return Ok(new PagedLotsDto([], 0, page, pageSize, LiveDto(snap) with { Unchanged = true }));

        var overrides = await OverridesFor(catalogueId);

        // Progressive load: a partial sale only ever grows at the end, so the client asks for just the
        // rows past what it already has (raw order — no filtering or sorting).
        if (snap is { Complete: false } && after is >= 0)
        {
            var fresh = lots.Skip(after.Value).Select(l => ToDto(l, Merged(l, overrides))).ToList();
            return Ok(new PagedLotsDto(fresh, lots.Count, 1, fresh.Count, LiveDto(snap)));
        }

        IEnumerable<(Lot Lot, Valuation? Val)> matched = lots.Select(l => (l, Merged(l, overrides)));

        if (!string.IsNullOrWhiteSpace(search))
        {
            bool Hit(string? s) => s is not null && s.Contains(search, StringComparison.OrdinalIgnoreCase);
            matched = matched.Where(x =>
                Hit(x.Lot.LotNumber) || Hit(x.Lot.Broker) || Hit(x.Lot.Grade) || Hit(x.Lot.Garden) ||
                Hit(x.Lot.Category) || Hit(x.Lot.Mark) || Hit(x.Lot.InvoiceNo));
        }
        if (!string.IsNullOrWhiteSpace(broker)) matched = matched.Where(x => x.Lot.Broker == broker);
        if (!string.IsNullOrWhiteSpace(grade)) matched = matched.Where(x => x.Lot.Grade == grade);
        if (!string.IsNullOrWhiteSpace(category)) matched = matched.Where(x => x.Lot.Category == category);
        if (!string.IsNullOrWhiteSpace(garden)) matched = matched.Where(x => x.Lot.Garden == garden);
        if (!string.IsNullOrWhiteSpace(status)) matched = matched.Where(x => TicketStatus(x.Val) == status);

        var list = matched.ToList();
        bool desc = sortDir < 0;
        IEnumerable<(Lot Lot, Valuation? Val)> sorted = sortKey switch
        {
            "Broker" => desc ? list.OrderByDescending(x => x.Lot.Broker) : list.OrderBy(x => x.Lot.Broker),
            "Grade" => desc ? list.OrderByDescending(x => x.Lot.Grade) : list.OrderBy(x => x.Lot.Grade),
            "Garden" => desc ? list.OrderByDescending(x => x.Lot.Garden) : list.OrderBy(x => x.Lot.Garden),
            "Valuation" => desc
                ? list.OrderByDescending(x => x.Val?.EffectiveValue)
                : list.OrderBy(x => x.Val?.EffectiveValue),
            _ => desc ? list.OrderByDescending(x => x.Lot.LotNumber) : list.OrderBy(x => x.Lot.LotNumber)
        };

        var rows = sorted.Skip((page - 1) * pageSize).Take(pageSize).Select(x => ToDto(x.Lot, x.Val)).ToList();
        return Ok(new PagedLotsDto(rows, list.Count, page, pageSize, snap is null ? null : LiveDto(snap)));
    }

    /// <summary>An OKLO sale is read live: whatever has arrived so far (the client polls until Live.Complete), with the last
    /// synced file as the fallback. Anything else comes from the source as before.</summary>
    private async Task<(IReadOnlyList<Lot>? Lots, LiveSnapshot? Snap)> ResolveLotsAsync(Guid catalogueId)
    {
        LiveSnapshot? snap = null;
        if (await liveSource.IsLiveAsync(catalogueId)) snap = await liveSource.GetSnapshotAsync(catalogueId, HttpContext.RequestAborted);
        return (snap?.Lots ?? source.GetLots(catalogueId), snap);
    }

    /// <summary>
    /// Search one sale WITHOUT the browser downloading it: the filter panel's state goes up, and only the matching rows
    /// (a window of <c>limit</c> starting at <c>offset</c>) come back, with the total number of matches. The sale itself
    /// stays in the backend (memory / stored snapshot), where filtering ~11,000 lots takes milliseconds.
    /// </summary>
    [HttpPost("catalogues/{catalogueId:guid}/lots/search")]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("saleSearch")]
    public async Task<ActionResult<PagedLotsDto>> Search(Guid catalogueId, [FromBody] LotSearchRequest request)
    {
        if (!LotSearch.IsReasonable(request)) return BadRequest("The search is too large.");
        var (lots, snap) = await ResolveLotsAsync(catalogueId);
        if (lots is null) return await liveSource.IsLiveAsync(catalogueId) ? SaleLoading() : NotFound();
        var overrides = await OverridesFor(catalogueId);

        var limit = Math.Clamp(request.Limit, 1, 20000);
        var offset = Math.Max(0, request.Offset);
        // Same default order as the lot list (by lot number), so a search and a plain listing agree.
        var matched = LotSearch.Filter(lots.Select(l => (l, Merged(l, overrides))), request)
            .OrderBy(x => x.Lot.LotNumber).ToList();
        var rows = matched.Skip(offset).Take(limit).Select(x => ToDto(x.Lot, x.Val)).ToList();
        return Ok(new PagedLotsDto(rows, matched.Count, offset / limit + 1, limit, snap is null ? null : LiveDto(snap)));
    }

    /// <summary>The dropdown option lists (distinct values, most frequent first) for the columns the filter panel asks
    /// about — computed where the sale lives, so the browser needs no lots to fill its filters.</summary>
    [HttpPost("catalogues/{catalogueId:guid}/filter-options")]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("saleSearch")]
    public async Task<ActionResult<FilterOptionsDto>> FilterOptions(Guid catalogueId, [FromBody] FilterOptionsRequest request)
    {
        if ((request.Headers?.Count ?? 0) > 100) return BadRequest("Too many columns requested.");
        var (lots, snap) = await ResolveLotsAsync(catalogueId);
        if (lots is null) return await liveSource.IsLiveAsync(catalogueId) ? SaleLoading() : NotFound();
        var options = LotSearch.BuildOptions(lots, request.Headers ?? []);
        return Ok(new FilterOptionsDto(options, snap?.Total ?? lots.Count, snap is null ? null : LiveDto(snap)));
    }

    /// <summary>An OKLO sale that has not produced rows yet: "try again" (503) rather than "not found" (404).</summary>
    private ObjectResult SaleLoading() =>
        StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "This sale is still loading from OKLO - it will appear in a moment." });

    private static LiveLoadDto LiveDto(LiveSnapshot snap) =>
        new(snap.Total, snap.Lots.Count, snap.Complete, snap.FetchedAtUtc, snap.Refreshing, snap.Error);

    internal static string TicketStatus(Valuation? v)
    {
        if (v is null) return "empty";
        var hasValue = v.ValuationSingle != null || v.ValuationFrom != null;
        var hasText = !string.IsNullOrEmpty(v.StandardData) || !string.IsNullOrEmpty(v.AdjectiveData) ||
                      !string.IsNullOrEmpty(v.LiquorRemarks) || !string.IsNullOrEmpty(v.MusterReport);
        if (!hasValue && !hasText) return "empty";
        if (hasValue && !string.IsNullOrEmpty(v.StandardData) && !string.IsNullOrEmpty(v.LiquorRemarks)) return "full";
        return "partial";
    }

    [HttpPatch("lots/{id:guid}/valuation")]
    public async Task<ActionResult<LotDto>> UpdateValuation(Guid id, ValuationUpdateDto dto)
    {
        var hit = source.FindLot(id);
        if (hit is null) return NotFound();
        var (lot, catalogue) = hit.Value;

        // Business rule: a valuation is always a whole LKR value of at most four digits —
        // between 50 and 9999 — and a range's first number is strictly lower than its
        // second. Mirrored client-side in frontend/src/lib/valuationInput.ts (where the
        // entry fields stop at four digits) — enforced here too so no caller can bypass it.
        static bool IsInvalid(decimal v) => v < 50 || v > 9999 || v != decimal.Truncate(v);
        foreach (var value in new[] { dto.ValuationFrom, dto.ValuationTo, dto.ValuationSingle })
            if (value.HasValue && IsInvalid(value.Value))
                return BadRequest("Every valuation must be a whole value between 50 and 9999.");

        if (dto.ValuationFrom.HasValue && dto.ValuationTo.HasValue && dto.ValuationFrom >= dto.ValuationTo)
            return BadRequest("ValuationFrom must be lower than ValuationTo.");

        // A lot holds either a single value or a full range, never both or half a range —
        // normalize legacy shapes rather than failing the save.
        var single = dto.ValuationSingle;
        var (from, to) = (dto.ValuationFrom, dto.ValuationTo);
        if (single.HasValue) (from, to) = (null, null);
        else if (from.HasValue != to.HasValue) (single, from, to) = (from ?? to, null, null);

        var stored = await db.Valuations.Find(v => v.LotId == id).FirstOrDefaultAsync();
        // Start from what the user currently sees (their override, else the file-derived
        // valuation) so an omitted Classification keeps its current tier.
        var current = stored?.Valuation ?? lot.Valuation;

        // Optimistic concurrency: the client always echoes back the UpdatedAt it last saw
        // (see ValuationDto.UpdatedAt). If that no longer matches what's actually stored,
        // someone else saved a change in between — reject rather than silently overwrite it.
        if (dto.ExpectedUpdatedAt != current?.UpdatedAt)
            return Conflict(new ValuationConflictDto(
                "This lot was updated by someone else since you opened it — your changes were not saved.",
                ToDto(lot, current)));

        var val = current?.Clone() ?? new Valuation();
        val.ValuationFrom = from;
        val.ValuationTo = to;
        val.ValuationSingle = single;
        if (dto.Classification is not null && Enum.TryParse<Classification>(dto.Classification, true, out var cls))
            val.Classification = cls;
        val.StandardData = dto.StandardData;
        val.AdjectiveData = dto.AdjectiveData;
        val.LiquorRemarks = dto.LiquorRemarks;
        val.MusterReport = dto.MusterReport;
        val.BrokerNotes = dto.BrokerNotes;
        val.PrivateNotes = dto.PrivateNotes;
        val.UpdatedAt = Valuation.UtcNowMillis();
        DropTierWithoutValue(val);

        await UpsertValuation(lot, catalogue.Id, val);
        return Ok(ToDto(lot, val));
    }

    /// <summary>
    /// A classification grades a valuation, so a lot with no value can't carry a tier —
    /// clearing the value clears the tier with it. Enforced on every write path so the two
    /// can never be stored out of step, whatever a client sends.
    /// </summary>
    private static void DropTierWithoutValue(Valuation val)
    {
        if (!HasValue(val)) val.Classification = Classification.Unclassified;
    }

    private static bool HasValue(Valuation val) =>
        val.ValuationSingle is not null || val.ValuationFrom is not null || val.ValuationTo is not null;

    [HttpPost("lots/bulk-classify")]
    public async Task<IActionResult> BulkClassify(BulkClassifyDto dto)
    {
        if (!Enum.TryParse<Classification>(dto.Classification, true, out var cls))
            return BadRequest("Invalid classification.");

        int updated = 0;
        int skipped = 0;
        foreach (var lotId in dto.LotIds)
        {
            var hit = source.FindLot(lotId);
            if (hit is null) continue;
            var (lot, catalogue) = hit.Value;
            var stored = await db.Valuations.Find(v => v.LotId == lotId).FirstOrDefaultAsync();
            var val = (stored?.Valuation ?? lot.Valuation)?.Clone() ?? new Valuation();
            // An unvalued lot can't be classified, so it's left alone entirely rather than
            // having an empty valuation stored for it.
            if (!HasValue(val))
            {
                skipped++;
                continue;
            }
            val.Classification = cls;
            val.UpdatedAt = Valuation.UtcNowMillis();
            await UpsertValuation(lot, catalogue.Id, val);
            updated++;
        }
        return Ok(new { updated, skipped });
    }

    [HttpPost("lots/bulk-clear-notes")]
    public async Task<IActionResult> BulkClearNotes(BulkDeleteNotesDto dto)
    {
        int updated = 0;
        foreach (var lotId in dto.LotIds)
        {
            var hit = source.FindLot(lotId);
            if (hit is null) continue;
            var (lot, catalogue) = hit.Value;
            var stored = await db.Valuations.Find(v => v.LotId == lotId).FirstOrDefaultAsync();
            var current = stored?.Valuation ?? lot.Valuation;
            if (current is null) continue;
            var val = current.Clone();
            val.StandardData = null;
            val.AdjectiveData = null;
            val.LiquorRemarks = null;
            val.MusterReport = null;
            val.BrokerNotes = null;
            val.PrivateNotes = null;
            val.UpdatedAt = Valuation.UtcNowMillis();
            await UpsertValuation(lot, catalogue.Id, val);
            updated++;
        }
        return Ok(new { updated });
    }

    private async Task UpsertValuation(Lot lot, Guid catalogueId, Valuation val) =>
        await db.Valuations.ReplaceOneAsync(
            v => v.LotId == lot.Id,
            new StoredValuation { LotId = lot.Id, CatalogueId = catalogueId, RowKey = lot.RowKey, Valuation = val },
            new ReplaceOptions { IsUpsert = true });

    private async Task<Dictionary<Guid, Valuation>> OverridesFor(Guid catalogueId) =>
        (await db.Valuations.Find(v => v.CatalogueId == catalogueId).ToListAsync())
            .ToDictionary(v => v.LotId, v => v.Valuation);

    /// <summary>A lot's user-entered override always wins over its file-derived valuation.
    /// Internal (not private) so other code in this assembly — e.g. DashboardController's
    /// stats computation, the AI assistant's read-only tools — applies the exact same rule
    /// instead of re-implementing it.</summary>
    internal static Valuation? Merged(Lot lot, Dictionary<Guid, Valuation> overrides) =>
        overrides.TryGetValue(lot.Id, out var v) ? v : lot.Valuation;

    internal static LotDto ToDto(Lot l, Valuation? v) => new(
        l.Id, l.RowKey, l.LotNumber, l.Broker, l.Grade, l.Garden, l.Category, l.Elevation, l.Region,
        l.Warehouse, l.Mark, l.SaleNo, l.SaleYear, l.InvoiceNo, l.NetWeight, l.GrossWeight, l.RawData,
        v is null ? null : new ValuationDto(
            v.ValuationFrom, v.ValuationTo, v.ValuationSingle,
            v.Classification.ToString(), v.StandardData, v.AdjectiveData,
            v.LiquorRemarks, v.MusterReport, v.BrokerNotes, v.PrivateNotes,
            v.UpdatedAt)
    );
}
