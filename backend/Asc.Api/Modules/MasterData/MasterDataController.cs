using Asc.Api.Data;
using Asc.Api.Models;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.MasterData;

/// <summary>
/// Admin-only management of canonical entities (broker/buyer/garden/grade/... names) and
/// their raw spelling variants. This is the write side only — resolution itself happens in
/// MasterDataResolver, called from Analytics/Market/Reports/Assistant at read time. Lot and
/// the file-backed catalogue store (SaleFileStore) are never modified by this controller.
/// </summary>
[ApiController]
[Route("api/v1/master-data")]
[Authorize(Policy = Policies.ManageMasterData)]
public class MasterDataController(MongoContext db, MasterDataResolver resolver, ICatalogueSource source, IAuditLogger audit) : ControllerBase
{
    /// <summary>How each entity type reads off a Lot — the one place that decides, e.g., that
    /// Buyer canonicalization is driven by the human-readable BuyerName (falling back to the
    /// short Buyer code only when BuyerName is blank), not the other way round. Used only by
    /// the Unmapped scan below; resolution itself (Analytics/Market/Reports) picks its own
    /// field per call site since not every consumer needs every entity type.</summary>
    private static readonly Dictionary<MasterDataEntityType, Func<Lot, string?>> LotFieldSelectors = new()
    {
        [MasterDataEntityType.Broker] = l => l.Broker,
        [MasterDataEntityType.Buyer] = l => string.IsNullOrWhiteSpace(l.BuyerName) ? l.Buyer : l.BuyerName,
        [MasterDataEntityType.Garden] = l => l.Garden,
        [MasterDataEntityType.Grade] = l => l.Grade,
        [MasterDataEntityType.Category] = l => l.Category,
        [MasterDataEntityType.Elevation] = l => l.Elevation,
        [MasterDataEntityType.Region] = l => l.Region,
        [MasterDataEntityType.Warehouse] = l => l.Warehouse,
        [MasterDataEntityType.Factory] = l => string.IsNullOrWhiteSpace(l.FactoryName) ? l.Factory : l.FactoryName,
    };

    [HttpGet]
    public async Task<ActionResult<List<MasterDataEntityDto>>> List([FromQuery] MasterDataEntityType? type, CancellationToken ct)
    {
        var filter = type.HasValue
            ? Builders<MasterDataEntity>.Filter.Eq(e => e.Type, type.Value)
            : FilterDefinition<MasterDataEntity>.Empty;
        var entities = await db.MasterDataEntities.Find(filter).SortBy(e => e.CanonicalName).ToListAsync(ct);
        return Ok(entities.Select(ToDto).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<MasterDataEntityDto>> Create(UpsertMasterDataEntityDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.CanonicalName)) return BadRequest("A canonical name is required.");
        if (!Enum.TryParse<MasterDataEntityType>(dto.Type, ignoreCase: true, out var type))
            return BadRequest($"Unknown entity type '{dto.Type}'.");

        var entity = new MasterDataEntity
        {
            Type = type,
            CanonicalName = dto.CanonicalName.Trim(),
            Aliases = CleanAliases(dto.Aliases),
        };
        await db.MasterDataEntities.InsertOneAsync(entity, cancellationToken: ct);
        await resolver.RefreshAsync(ct);
        await audit.LogAsync(User, "master_data.created", entity.Type.ToString(), entity.Id.ToString(), entity.CanonicalName, ct);

        return Ok(ToDto(entity));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<MasterDataEntityDto>> Update(Guid id, UpsertMasterDataEntityDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.CanonicalName)) return BadRequest("A canonical name is required.");
        if (!Enum.TryParse<MasterDataEntityType>(dto.Type, ignoreCase: true, out var type))
            return BadRequest($"Unknown entity type '{dto.Type}'.");

        var update = Builders<MasterDataEntity>.Update
            .Set(e => e.Type, type)
            .Set(e => e.CanonicalName, dto.CanonicalName.Trim())
            .Set(e => e.Aliases, CleanAliases(dto.Aliases))
            .Set(e => e.UpdatedAt, DateTime.UtcNow);

        var result = await db.MasterDataEntities.FindOneAndUpdateAsync(
            e => e.Id == id, update,
            new FindOneAndUpdateOptions<MasterDataEntity> { ReturnDocument = ReturnDocument.After }, ct);
        if (result is null) return NotFound();

        await resolver.RefreshAsync(ct);
        await audit.LogAsync(User, "master_data.updated", result.Type.ToString(), result.Id.ToString(), result.CanonicalName, ct);
        return Ok(ToDto(result));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var entity = await db.MasterDataEntities.Find(e => e.Id == id).FirstOrDefaultAsync(ct);
        await db.MasterDataEntities.DeleteOneAsync(e => e.Id == id, ct);
        await resolver.RefreshAsync(ct);
        await audit.LogAsync(User, "master_data.deleted", entity?.Type.ToString(), id.ToString(), entity?.CanonicalName, ct);
        return NoContent();
    }

    /// <summary>Distinct raw values for a type, across every sale, that don't currently
    /// resolve to any canonical entity — what the admin screen uses to drive alias assignment
    /// instead of guessing spelling variants across 30+ broker files. Reads straight from
    /// ICatalogueSource (the same file-backed store every other controller uses), so this
    /// always reflects whatever sales are currently on disk.</summary>
    [HttpGet("unmapped")]
    public ActionResult<List<UnmappedValueDto>> Unmapped([FromQuery] MasterDataEntityType type)
    {
        var selector = LotFieldSelectors[type];
        var counts = new Dictionary<string, int>();

        foreach (var catalogue in source.ListCatalogues())
        {
            var lots = source.GetLots(catalogue.Id);
            if (lots is null) continue;

            foreach (var lot in lots)
            {
                var raw = selector(lot)?.Trim();
                if (string.IsNullOrWhiteSpace(raw) || resolver.IsMapped(type, raw)) continue;
                counts[raw] = counts.GetValueOrDefault(raw) + 1;
            }
        }

        return Ok(counts
            .Select(kv => new UnmappedValueDto(kv.Key, kv.Value))
            .OrderByDescending(v => v.Count)
            .ToList());
    }

    private static List<string> CleanAliases(List<string> aliases) =>
        [.. aliases.Select(a => a.Trim()).Where(a => a.Length > 0).Distinct()];

    private static MasterDataEntityDto ToDto(MasterDataEntity e) => new(e.Id, e.Type.ToString(), e.CanonicalName, e.Aliases, e.CreatedAt, e.UpdatedAt);
}
