using Asc.Api.Data;
using Asc.Api.DTOs;
using Asc.Api.Models;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Controllers;

[ApiController]
[Route("api")]
public class LotsController(MongoContext db) : ControllerBase
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
        [FromQuery] int pageSize = 50)
    {
        var filterBuilder = Builders<Lot>.Filter;
        var filter = filterBuilder.Eq(l => l.CatalogueId, catalogueId);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var regex = new MongoDB.Bson.BsonRegularExpression(System.Text.RegularExpressions.Regex.Escape(search), "i");
            filter &= filterBuilder.Or(
                filterBuilder.Regex(l => l.LotNumber, regex),
                filterBuilder.Regex(l => l.Broker, regex),
                filterBuilder.Regex(l => l.Grade, regex),
                filterBuilder.Regex(l => l.Garden, regex),
                filterBuilder.Regex(l => l.Category, regex),
                filterBuilder.Regex(l => l.Mark, regex),
                filterBuilder.Regex(l => l.InvoiceNo, regex));
        }
        if (!string.IsNullOrWhiteSpace(broker)) filter &= filterBuilder.Eq(l => l.Broker, broker);
        if (!string.IsNullOrWhiteSpace(grade)) filter &= filterBuilder.Eq(l => l.Grade, grade);
        if (!string.IsNullOrWhiteSpace(category)) filter &= filterBuilder.Eq(l => l.Category, category);
        if (!string.IsNullOrWhiteSpace(garden)) filter &= filterBuilder.Eq(l => l.Garden, garden);

        // Fetched then filtered/sorted/paged in-memory: simpler and less error-prone than
        // translating the "ticket status" and sort logic into Mongo query operators, and
        // fine for the data volumes this is meant to handle.
        var matched = await db.Lots.Find(filter).ToListAsync();

        if (!string.IsNullOrWhiteSpace(status))
        {
            matched = matched.Where(l => TicketStatus(l) == status).ToList();
        }

        bool desc = sortDir < 0;
        IEnumerable<Lot> sorted = sortKey switch
        {
            "Broker" => desc ? matched.OrderByDescending(l => l.Broker) : matched.OrderBy(l => l.Broker),
            "Grade" => desc ? matched.OrderByDescending(l => l.Grade) : matched.OrderBy(l => l.Grade),
            "Garden" => desc ? matched.OrderByDescending(l => l.Garden) : matched.OrderBy(l => l.Garden),
            "Valuation" => desc
                ? matched.OrderByDescending(l => l.Valuation?.EffectiveValue)
                : matched.OrderBy(l => l.Valuation?.EffectiveValue),
            _ => desc ? matched.OrderByDescending(l => l.LotNumber) : matched.OrderBy(l => l.LotNumber)
        };

        var total = matched.Count;
        var rows = sorted.Skip((page - 1) * pageSize).Take(pageSize).Select(ToDto).ToList();

        return Ok(new PagedLotsDto(rows, total, page, pageSize));
    }

    private static string TicketStatus(Lot l)
    {
        var v = l.Valuation;
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
        var lot = await db.Lots.Find(l => l.Id == id).FirstOrDefaultAsync();
        if (lot is null) return NotFound();

        // Business rule: a valuation is always a whole LKR value between 500 and 5000, and a
        // range's first number is strictly lower than its second. Mirrored client-side in
        // frontend/src/lib/valuationInput.ts — enforced here too so no caller can bypass it.
        static bool IsInvalid(decimal v) => v < 500 || v > 5000 || v != decimal.Truncate(v);
        foreach (var value in new[] { dto.ValuationFrom, dto.ValuationTo, dto.ValuationSingle })
            if (value.HasValue && IsInvalid(value.Value))
                return BadRequest("Every valuation must be a whole value between 500 and 5000.");

        if (dto.ValuationFrom.HasValue && dto.ValuationTo.HasValue && dto.ValuationFrom >= dto.ValuationTo)
            return BadRequest("ValuationFrom must be lower than ValuationTo.");

        // A lot holds either a single value or a full range, never both or half a range.
        // Field-preserving patches built from legacy data can still carry the old shapes
        // (both set, or a lone From/To) — normalize those rather than failing the save:
        // the single wins over a range (matching EffectiveValue's precedence), and a lone
        // range end becomes the single value.
        var single = dto.ValuationSingle;
        var (from, to) = (dto.ValuationFrom, dto.ValuationTo);
        if (single.HasValue) (from, to) = (null, null);
        else if (from.HasValue != to.HasValue) (single, from, to) = (from ?? to, null, null);

        lot.Valuation ??= new Valuation();
        lot.Valuation.ValuationFrom = from;
        lot.Valuation.ValuationTo = to;
        lot.Valuation.ValuationSingle = single;
        if (dto.Classification is not null && Enum.TryParse<Classification>(dto.Classification, true, out var cls))
            lot.Valuation.Classification = cls;
        lot.Valuation.StandardData = dto.StandardData;
        lot.Valuation.AdjectiveData = dto.AdjectiveData;
        lot.Valuation.LiquorRemarks = dto.LiquorRemarks;
        lot.Valuation.MusterReport = dto.MusterReport;
        lot.Valuation.BrokerNotes = dto.BrokerNotes;
        lot.Valuation.PrivateNotes = dto.PrivateNotes;
        lot.Valuation.UpdatedAt = DateTime.UtcNow;

        await db.Lots.ReplaceOneAsync(l => l.Id == id, lot);
        return Ok(ToDto(lot));
    }

    [HttpPost("lots/bulk-classify")]
    public async Task<IActionResult> BulkClassify(BulkClassifyDto dto)
    {
        if (!Enum.TryParse<Classification>(dto.Classification, true, out var cls))
            return BadRequest("Invalid classification.");

        var lots = await db.Lots.Find(l => dto.LotIds.Contains(l.Id)).ToListAsync();
        foreach (var lot in lots)
        {
            lot.Valuation ??= new Valuation();
            lot.Valuation.Classification = cls;
            lot.Valuation.UpdatedAt = DateTime.UtcNow;
            await db.Lots.ReplaceOneAsync(l => l.Id == lot.Id, lot);
        }
        return Ok(new { updated = lots.Count });
    }

    [HttpPost("lots/bulk-clear-notes")]
    public async Task<IActionResult> BulkClearNotes(BulkDeleteNotesDto dto)
    {
        var lots = await db.Lots.Find(l => dto.LotIds.Contains(l.Id)).ToListAsync();
        foreach (var lot in lots.Where(l => l.Valuation is not null))
        {
            lot.Valuation!.StandardData = null;
            lot.Valuation.AdjectiveData = null;
            lot.Valuation.LiquorRemarks = null;
            lot.Valuation.MusterReport = null;
            lot.Valuation.BrokerNotes = null;
            lot.Valuation.PrivateNotes = null;
            lot.Valuation.UpdatedAt = DateTime.UtcNow;
            await db.Lots.ReplaceOneAsync(l => l.Id == lot.Id, lot);
        }
        return Ok(new { updated = lots.Count });
    }

    private static LotDto ToDto(Lot l) => new(
        l.Id, l.RowKey, l.LotNumber, l.Broker, l.Grade, l.Garden, l.Category, l.Elevation, l.Region,
        l.Warehouse, l.Mark, l.SaleNo, l.SaleYear, l.InvoiceNo, l.NetWeight, l.GrossWeight, l.RawData,
        l.Valuation is null ? null : new ValuationDto(
            l.Valuation.ValuationFrom, l.Valuation.ValuationTo, l.Valuation.ValuationSingle,
            l.Valuation.Classification.ToString(), l.Valuation.StandardData, l.Valuation.AdjectiveData,
            l.Valuation.LiquorRemarks, l.Valuation.MusterReport, l.Valuation.BrokerNotes, l.Valuation.PrivateNotes,
            l.Valuation.UpdatedAt)
    );
}
