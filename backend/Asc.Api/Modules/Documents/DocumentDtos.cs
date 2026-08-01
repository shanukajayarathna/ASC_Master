namespace Asc.Api.Modules.Documents;

public record DocumentDto(Guid Id, string FileName, string ContentType, long SizeBytes, DateTime UploadedAt);

public record SearchResultDto(string DocumentFileName, Guid DocumentId, string ChunkText, double Score);
