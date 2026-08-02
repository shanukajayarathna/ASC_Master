using Asc.Api.Data;
using Asc.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.FilterPresets;

/// <summary>
/// Wires up the FilterPreset collection, which existed unused (see FilterPreset.cs) — mirrors
/// ReportsController's saved-report trio exactly, since the shapes line up (Id, CatalogueId,
/// Name, CreatedAt). Saves the Catalogue Manager's real filter state (columnFilters/status/
/// classification/year/search, from lotFilters.ts), not AG Grid's own per-column filters,
/// which the stub this replaces incorrectly assumed were the source of truth.
/// </summary>
[ApiController]
[Route("api/v1/filter-presets")]
[Authorize]
public class FilterPresetsController(MongoContext db) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<FilterPresetDto>> Save(SaveFilterPresetRequestDto dto, CancellationToken ct)
    {
        var preset = new FilterPreset
        {
            CatalogueId = dto.CatalogueId,
            Name = dto.Name,
            FiltersJson = dto.FiltersJson,
        };
        await db.FilterPresets.InsertOneAsync(preset, cancellationToken: ct);
        return Ok(ToDto(preset));
    }

    [HttpGet]
    public async Task<ActionResult<List<FilterPresetDto>>> List(CancellationToken ct)
    {
        var list = await db.FilterPresets.Find(FilterDefinition<FilterPreset>.Empty)
            .SortByDescending(p => p.CreatedAt).ToListAsync(ct);
        return Ok(list.Select(ToDto).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<FilterPresetDto>> Get(Guid id, CancellationToken ct)
    {
        var preset = await db.FilterPresets.Find(p => p.Id == id).FirstOrDefaultAsync(ct);
        return preset is null ? NotFound() : Ok(ToDto(preset));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await db.FilterPresets.DeleteOneAsync(p => p.Id == id, ct);
        return NoContent();
    }

    private static FilterPresetDto ToDto(FilterPreset p) => new(p.Id, p.CatalogueId, p.Name, p.FiltersJson, p.CreatedAt);
}
