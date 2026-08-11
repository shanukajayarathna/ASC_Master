namespace Asc.Api.Modules.Documents;

// Category travels as a plain string (e.g. "Authoritative"), matching this codebase's
// established convention for enum-shaped DTO fields (MasterDataEntityType, role names)
// rather than a global JsonStringEnumConverter.

public record DocumentDto(
    Guid Id, string FileName, string ContentType, long SizeBytes, DateTime UploadedAt,
    string Category, DateTime? EffectiveDate, DateTime? ExpiryDate,
    Guid? SupersedesDocumentId, Guid? SupersededByDocumentId);

public record SearchResultDto(string DocumentFileName, Guid DocumentId, string ChunkText, double Score, string Category);
