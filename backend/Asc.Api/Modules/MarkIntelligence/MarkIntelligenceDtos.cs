namespace Asc.Api.Modules.MarkIntelligence;

public record PlantationDto(Guid Id, string Name, bool IsActive, int FactoryCount);
public record CreatePlantationDto(string Name);
public record UpdatePlantationDto(string Name, bool IsActive);

public record FactoryDto(Guid Id, Guid? PlantationId, string Code, string Name, bool IsActive, int MarkCount);
public record CreateFactoryDto(Guid? PlantationId, string Code, string Name);
public record UpdateFactoryDto(Guid? PlantationId, string Code, string Name, bool IsActive);

public record MarkBrokerEraDto(List<string> Brokers, bool IsShared, int StartYear, int StartSaleNo, int? EndYear, int? EndSaleNo);

public record MarkDto(
    Guid Id,
    Guid FactoryId,
    string FactoryCode,
    string FactoryName,
    Guid? PlantationId,
    string? PlantationName,
    string Code,
    string Name,
    string Status,
    List<string> CurrentBrokers,
    bool IsCurrentlyShared,
    List<MarkBrokerEraDto> Timeline);

public record CreateMarkDto(Guid FactoryId, string Name, string Code);
public record UpdateMarkDto(string Name, string Code, string Status);

/// <summary>Plain-language result of a mining run, for an admin to sanity-check before
/// trusting the derived history — counts only, no line-by-line dump.</summary>
public record MiningRunResultDto(
    int FactoriesSeen,
    int MarksSeen,
    int NewMarksCreated,
    int PeriodFactsWritten,
    int ErasComputed,
    int MarksWithMultipleEras,
    int MarksEverShared,
    // A mark whose sale history spans more than one MslCode within the mined window — an
    // estate re-registration or similar, not a data error. Its Mark record tracks whichever
    // factory carries its most recent activity.
    int MarksThatChangedFactory,
    DateTime RunAt);
