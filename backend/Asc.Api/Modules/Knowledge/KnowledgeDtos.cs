namespace Asc.Api.Modules.Knowledge;

/// <summary>Source-agnostic on purpose — "Title/Snippet" rather than "DocumentFileName/
/// ChunkText" — so a future MSL/Tea Board/OKLO source returns the exact same shape as the
/// document knowledge base without KnowledgeService or any agent needing to know the
/// difference.</summary>
public record KnowledgeResultDto(string SourceName, string Title, string Snippet, double Score, string? Category, string? ReferenceId);
