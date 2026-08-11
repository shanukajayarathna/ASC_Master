namespace Asc.Api.Modules.MasterData;

// Type travels as a plain string over the wire (e.g. "Broker"), matching this codebase's
// existing convention for enum-shaped DTO fields (see ValuationDto's Classification,
// SetRoleDto's Role) rather than a global JsonStringEnumConverter, which would silently
// change the wire format of every other enum already serialized elsewhere in the app.

public record MasterDataEntityDto(Guid Id, string Type, string CanonicalName, List<string> Aliases, DateTime CreatedAt, DateTime UpdatedAt);

public record UpsertMasterDataEntityDto(string Type, string CanonicalName, List<string> Aliases);

/// <summary>One raw value seen in source files that doesn't yet resolve to any canonical
/// entity, with how many lots (across every sale) carry it — lets an admin prioritize which
/// spelling variants are worth mapping instead of guessing across 30+ broker files.</summary>
public record UnmappedValueDto(string Value, int Count);
