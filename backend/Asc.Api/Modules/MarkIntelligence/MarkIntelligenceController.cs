using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.MarkIntelligence;

/// <summary>
/// Plantation → Factory → Mark browsing + admin management, and the broker-history mining
/// trigger. Reading the hierarchy needs no special policy (any authenticated user — this is
/// internal reference data, not public); adding/editing/removing entities and re-running the
/// mining job are Admin-only (Policies.ManageMarkIntelligence). See MarkIntelligenceModels.cs
/// for why Broker isn't a manageable entity here (Modules/Msl's MslBrokers already is the
/// fixed, complete list) and why a Mark's unique "code" is its trading name, not a factory
/// registration number.
/// </summary>
[ApiController]
[Route("api/v1/mark-intelligence")]
[Authorize]
public class MarkIntelligenceController(MongoContext db, IAuditLogger audit, MarkIntelligenceMiningService mining) : ControllerBase
{
    // ---------------------------------------------------------------------------------
    // Browse (any authenticated user)
    // ---------------------------------------------------------------------------------

    [HttpGet("plantations")]
    public async Task<ActionResult<List<PlantationDto>>> ListPlantations(CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var plantations = await db.Plantations.Find(FilterDefinition<Plantation>.Empty).SortBy(p => p.Name).ToListAsync(ct);
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factories = await db.Factories.Find(FilterDefinition<Factory>.Empty).ToListAsync(ct);
        var countByPlantation = factories.Where(f => f.PlantationId.HasValue).GroupBy(f => f.PlantationId!.Value).ToDictionary(g => g.Key, g => g.Count());
        return Ok(plantations.Select(p => new PlantationDto(p.Id, p.Name, p.IsActive, countByPlantation.GetValueOrDefault(p.Id))).ToList());
    }

    [HttpGet("plantations/{id:guid}/factories")]
    public async Task<ActionResult<List<FactoryDto>>> ListFactoriesForPlantation(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factories = await db.Factories.Find(f => f.PlantationId == id).SortBy(f => f.Name).ToListAsync(ct);
        return Ok(await ToFactoryDtosAsync(factories, ct));
    }

    /// <summary>Factories with no known plantation group — real for most of the archive
    /// (plantation-group data only exists in recent weekly sale catalogues).</summary>
    [HttpGet("factories/unassigned")]
    public async Task<ActionResult<List<FactoryDto>>> ListUnassignedFactories(CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factories = await db.Factories.Find(f => f.PlantationId == null).SortBy(f => f.Name).ToListAsync(ct);
        return Ok(await ToFactoryDtosAsync(factories, ct));
    }

    [HttpGet("factories/{id:guid}/marks")]
    public async Task<ActionResult<List<MarkDto>>> ListMarksForFactory(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var marks = await db.Marks.Find(m => m.FactoryId == id).SortBy(m => m.Name).ToListAsync(ct);
        return Ok(await ToMarkDtosAsync(marks, ct));
    }

    [HttpGet("marks/{id:guid}")]
    public async Task<ActionResult<MarkDto>> GetMark(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var mark = await db.Marks.Find(m => m.Id == id).FirstOrDefaultAsync(ct);
        if (mark is null) return NotFound();
        var dtos = await ToMarkDtosAsync([mark], ct);
        return Ok(dtos[0]);
    }

    /// <summary>Search by mark or factory code/name across the whole hierarchy — the plan's
    /// "simple search/filter" requirement. Capped at 50 results; this is a reference lookup,
    /// not a report.</summary>
    [HttpGet("search")]
    public async Task<ActionResult<List<MarkDto>>> Search([FromQuery] string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q)) return Ok(new List<MarkDto>());
        var filter = Builders<Mark>.Filter.Or(
            Builders<Mark>.Filter.Regex(m => m.Code, new MongoDB.Bson.BsonRegularExpression(q, "i")),
            Builders<Mark>.Filter.Regex(m => m.Name, new MongoDB.Bson.BsonRegularExpression(q, "i")));
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var marks = await db.Marks.Find(filter).Limit(50).ToListAsync(ct);
        return Ok(await ToMarkDtosAsync(marks, ct));
    }

    // ---------------------------------------------------------------------------------
    // Admin: Plantation CRUD
    // ---------------------------------------------------------------------------------

    [HttpPost("plantations")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<ActionResult<PlantationDto>> CreatePlantation(CreatePlantationDto dto, CancellationToken ct)
    {
        var name = dto.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(name)) return BadRequest("Name is required.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        if (await db.Plantations.Find(p => p.Name == name).AnyAsync(ct))
            return BadRequest($"A plantation named '{name}' already exists.");

        var plantation = new Plantation { Name = name };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.Plantations.InsertOneAsync(plantation, cancellationToken: ct);
        await audit.LogAsync(User, "MarkIntelligence.CreatePlantation", "Plantation", plantation.Id.ToString(), name, ct);
        return Ok(new PlantationDto(plantation.Id, plantation.Name, plantation.IsActive, 0));
    }

    [HttpPut("plantations/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> UpdatePlantation(Guid id, UpdatePlantationDto dto, CancellationToken ct)
    {
        var name = dto.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(name)) return BadRequest("Name is required.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var result = await db.Plantations.UpdateOneAsync(
            Builders<Plantation>.Filter.Eq(p => p.Id, id),
            Builders<Plantation>.Update.Set(p => p.Name, name).Set(p => p.IsActive, dto.IsActive).Set(p => p.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (result.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.UpdatePlantation", "Plantation", id.ToString(), name, ct);
        return NoContent();
    }

    /// <summary>Hard-deletes only when nothing references this plantation yet; otherwise
    /// deactivates it (hides it from active pickers, keeps its factories' history intact).</summary>
    [HttpDelete("plantations/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> DeletePlantation(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var hasFactories = await db.Factories.Find(f => f.PlantationId == id).AnyAsync(ct);
        if (!hasFactories)
        {
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            var result = await db.Plantations.DeleteOneAsync(p => p.Id == id, ct);
            if (result.DeletedCount == 0) return NotFound();
            await audit.LogAsync(User, "MarkIntelligence.DeletePlantation", "Plantation", id.ToString(), "hard delete (no factories)", ct);
            return NoContent();
        }
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var deactivated = await db.Plantations.UpdateOneAsync(
            Builders<Plantation>.Filter.Eq(p => p.Id, id),
            Builders<Plantation>.Update.Set(p => p.IsActive, false).Set(p => p.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (deactivated.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.DeactivatePlantation", "Plantation", id.ToString(), "has factories — deactivated instead of deleted", ct);
        return Ok(new { deactivated = true, reason = "This plantation has factories under it, so it was deactivated rather than deleted." });
    }

    // ---------------------------------------------------------------------------------
    // Admin: Factory CRUD
    // ---------------------------------------------------------------------------------

    [HttpPost("factories")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<ActionResult<FactoryDto>> CreateFactory(CreateFactoryDto dto, CancellationToken ct)
    {
        var code = dto.Code?.Trim().ToUpperInvariant().Replace(" ", "") ?? "";
        var name = dto.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(name)) return BadRequest("Code and name are required.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var existing = await db.Factories.Find(f => f.Code == code).FirstOrDefaultAsync(ct);
        if (existing is not null) return BadRequest($"Factory code '{code}' is already used by '{existing.Name}'.");

        var factory = new Factory { Code = code, Name = name, PlantationId = dto.PlantationId };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.Factories.InsertOneAsync(factory, cancellationToken: ct);
        await audit.LogAsync(User, "MarkIntelligence.CreateFactory", "Factory", factory.Id.ToString(), $"{code} — {name}", ct);
        return Ok((await ToFactoryDtosAsync([factory], ct))[0]);
    }

    [HttpPut("factories/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> UpdateFactory(Guid id, UpdateFactoryDto dto, CancellationToken ct)
    {
        var code = dto.Code?.Trim().ToUpperInvariant().Replace(" ", "") ?? "";
        var name = dto.Name?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(name)) return BadRequest("Code and name are required.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var codeHolder = await db.Factories.Find(f => f.Code == code && f.Id != id).FirstOrDefaultAsync(ct);
        if (codeHolder is not null) return BadRequest($"Factory code '{code}' is already used by '{codeHolder.Name}'.");

        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var result = await db.Factories.UpdateOneAsync(
            Builders<Factory>.Filter.Eq(f => f.Id, id),
            Builders<Factory>.Update
                .Set(f => f.Code, code).Set(f => f.Name, name)
                .Set(f => f.PlantationId, dto.PlantationId).Set(f => f.IsActive, dto.IsActive)
                .Set(f => f.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (result.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.UpdateFactory", "Factory", id.ToString(), $"{code} — {name}", ct);
        return NoContent();
    }

    [HttpDelete("factories/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> DeleteFactory(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var hasMarks = await db.Marks.Find(m => m.FactoryId == id).AnyAsync(ct);
        if (!hasMarks)
        {
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            var result = await db.Factories.DeleteOneAsync(f => f.Id == id, ct);
            if (result.DeletedCount == 0) return NotFound();
            await audit.LogAsync(User, "MarkIntelligence.DeleteFactory", "Factory", id.ToString(), "hard delete (no marks)", ct);
            return NoContent();
        }
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var deactivated = await db.Factories.UpdateOneAsync(
            Builders<Factory>.Filter.Eq(f => f.Id, id),
            Builders<Factory>.Update.Set(f => f.IsActive, false).Set(f => f.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (deactivated.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.DeactivateFactory", "Factory", id.ToString(), "has marks — deactivated instead of deleted", ct);
        return Ok(new { deactivated = true, reason = "This factory has marks under it, so it was deactivated rather than deleted." });
    }

    // ---------------------------------------------------------------------------------
    // Admin: Mark CRUD
    // ---------------------------------------------------------------------------------

    [HttpPost("marks")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<ActionResult<MarkDto>> CreateMark(CreateMarkDto dto, CancellationToken ct)
    {
        var code = dto.Code?.Trim().ToUpperInvariant() ?? "";
        var name = dto.Name?.Trim() ?? code;
        if (string.IsNullOrWhiteSpace(code)) return BadRequest("Code is required.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factory = await db.Factories.Find(f => f.Id == dto.FactoryId).FirstOrDefaultAsync(ct);
        if (factory is null) return BadRequest("Unknown factory.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var codeHolder = await db.Marks.Find(m => m.Code == code).FirstOrDefaultAsync(ct);
        if (codeHolder is not null) return BadRequest($"Mark code '{code}' is already used (factory: {factory.Name}).");

        var mark = new Mark { FactoryId = dto.FactoryId, Code = code, Name = name };
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.Marks.InsertOneAsync(mark, cancellationToken: ct);
        await audit.LogAsync(User, "MarkIntelligence.CreateMark", "Mark", mark.Id.ToString(), $"{code} under {factory.Code}", ct);
        return Ok((await ToMarkDtosAsync([mark], ct))[0]);
    }

    [HttpPut("marks/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> UpdateMark(Guid id, UpdateMarkDto dto, CancellationToken ct)
    {
        var code = dto.Code?.Trim().ToUpperInvariant() ?? "";
        var name = dto.Name?.Trim() ?? code;
        if (string.IsNullOrWhiteSpace(code)) return BadRequest("Code is required.");
        if (dto.Status != MarkStatus.Active && dto.Status != MarkStatus.Discontinued) return BadRequest("Status must be Active or Discontinued.");
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var codeHolder = await db.Marks.Find(m => m.Code == code && m.Id != id).FirstOrDefaultAsync(ct);
        if (codeHolder is not null) return BadRequest($"Mark code '{code}' is already in use.");

        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var result = await db.Marks.UpdateOneAsync(
            Builders<Mark>.Filter.Eq(m => m.Id, id),
            Builders<Mark>.Update.Set(m => m.Code, code).Set(m => m.Name, name).Set(m => m.Status, dto.Status).Set(m => m.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (result.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.UpdateMark", "Mark", id.ToString(), $"{code} ({dto.Status})", ct);
        return NoContent();
    }

    /// <summary>Hard-deletes only when the mark has never appeared in the mined archive
    /// (e.g. an admin typo caught immediately); otherwise marks it Discontinued so its
    /// broker history stays intact and queryable.</summary>
    [HttpDelete("marks/{id:guid}")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<IActionResult> DeleteMark(Guid id, CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var hasHistory = await db.MarkBrokerPeriodFacts.Find(f => f.MarkId == id).AnyAsync(ct);
        if (!hasHistory)
        {
            // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
            var result = await db.Marks.DeleteOneAsync(m => m.Id == id, ct);
            if (result.DeletedCount == 0) return NotFound();
            await audit.LogAsync(User, "MarkIntelligence.DeleteMark", "Mark", id.ToString(), "hard delete (no sale history)", ct);
            return NoContent();
        }
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var deactivated = await db.Marks.UpdateOneAsync(
            Builders<Mark>.Filter.Eq(m => m.Id, id),
            Builders<Mark>.Update.Set(m => m.Status, MarkStatus.Discontinued).Set(m => m.UpdatedAt, DateTime.UtcNow),
            cancellationToken: ct);
        if (deactivated.MatchedCount == 0) return NotFound();
        await audit.LogAsync(User, "MarkIntelligence.DiscontinueMark", "Mark", id.ToString(), "has sale history — discontinued instead of deleted", ct);
        return Ok(new { deactivated = true, reason = "This mark has real sale history, so it was marked Discontinued rather than deleted." });
    }

    // ---------------------------------------------------------------------------------
    // Admin: mining
    // ---------------------------------------------------------------------------------

    /// <summary>Re-runs the historical broker-history mining job against the current Msl
    /// archive. Safe to re-run any time (e.g. after new sales land, or after admin edits to
    /// Plantation/Factory names) — see MarkIntelligenceMiningService's doc comment.</summary>
    [HttpPost("mine")]
    [Authorize(Policy = Policies.ManageMarkIntelligence)]
    public async Task<ActionResult<MiningRunResultDto>> RunMining(CancellationToken ct)
    {
        var result = await mining.RunAsync(ct);
        await audit.LogAsync(User, "MarkIntelligence.RunMining",
            details: $"{result.MarksSeen} marks, {result.NewMarksCreated} new, {result.MarksWithMultipleEras} with a detected broker change", ct: ct);
        return Ok(result);
    }

    // ---------------------------------------------------------------------------------
    // DTO assembly helpers
    // ---------------------------------------------------------------------------------

    private async Task<List<FactoryDto>> ToFactoryDtosAsync(List<Factory> factories, CancellationToken ct)
    {
        if (factories.Count == 0) return [];
        var ids = factories.Select(f => f.Id).ToList();
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var marks = await db.Marks.Find(m => ids.Contains(m.FactoryId)).ToListAsync(ct);
        var countByFactory = marks.GroupBy(m => m.FactoryId).ToDictionary(g => g.Key, g => g.Count());
        return factories.Select(f => new FactoryDto(f.Id, f.PlantationId, f.Code, f.Name, f.IsActive, countByFactory.GetValueOrDefault(f.Id))).ToList();
    }

    private async Task<List<MarkDto>> ToMarkDtosAsync(List<Mark> marks, CancellationToken ct)
    {
        if (marks.Count == 0) return [];
        var factoryIds = marks.Select(m => m.FactoryId).Distinct().ToList();
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var factories = await db.Factories.Find(f => factoryIds.Contains(f.Id)).ToListAsync(ct);
        var factoryById = factories.ToDictionary(f => f.Id);
        var plantationIds = factories.Where(f => f.PlantationId.HasValue).Select(f => f.PlantationId!.Value).Distinct().ToList();
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var plantations = plantationIds.Count > 0 ? await db.Plantations.Find(p => plantationIds.Contains(p.Id)).ToListAsync(ct) : [];
        var plantationById = plantations.ToDictionary(p => p.Id);

        var markIds = marks.Select(m => m.Id).ToList();
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var eras = await db.MarkBrokerEras.Find(e => markIds.Contains(e.MarkId)).ToListAsync(ct);
        var erasByMark = eras.GroupBy(e => e.MarkId).ToDictionary(g => g.Key, g => g.OrderBy(e => e.StartYear * 100 + e.StartSaleNo).ToList());

        return marks.Select(m =>
        {
            var factory = factoryById.GetValueOrDefault(m.FactoryId);
            var plantation = factory?.PlantationId is { } pid ? plantationById.GetValueOrDefault(pid) : null;
            var timeline = erasByMark.GetValueOrDefault(m.Id, [])
                .Select(e => new MarkBrokerEraDto(e.Brokers, e.IsShared, e.StartYear, e.StartSaleNo, e.EndYear, e.EndSaleNo))
                .ToList();
            return new MarkDto(
                m.Id, m.FactoryId, factory?.Code ?? "", factory?.Name ?? "",
                factory?.PlantationId, plantation?.Name,
                m.Code, m.Name, m.Status, m.CurrentBrokers, m.IsCurrentlyShared, timeline);
        }).ToList();
    }
}
