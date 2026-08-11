namespace Asc.Api.Modules.Knowledge;

/// <summary>
/// The seam between agents and knowledge sources — agents call this, never a source (or a
/// raw file) directly. Today this fans out across one source (uploaded documents); adding
/// MSL/Tea Board/OKLO later is purely a matter of registering another IKnowledgeSource.
/// </summary>
public interface IKnowledgeService
{
    Task<List<KnowledgeResultDto>> SearchKnowledgeAsync(string query, CancellationToken ct = default);
}
