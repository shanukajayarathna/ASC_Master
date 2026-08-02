namespace Asc.Api.Modules.FilterPresets;

public record SaveFilterPresetRequestDto(Guid CatalogueId, string Name, string FiltersJson);

public record FilterPresetDto(Guid Id, Guid CatalogueId, string Name, string FiltersJson, DateTime CreatedAt);
