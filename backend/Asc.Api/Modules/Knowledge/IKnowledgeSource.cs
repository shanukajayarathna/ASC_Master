namespace Asc.Api.Modules.Knowledge;

/// <summary>
/// One searchable body of knowledge behind the Knowledge Platform — the uploaded document
/// library today (DocumentKnowledgeSource), and eventually MSL/Tea Board/OKLO/future
/// sources. Implement this and register it in DI; KnowledgeService and every agent pick it
/// up automatically, with no other code change.
/// </summary>
public interface IKnowledgeSource
{
    string SourceName { get; }

    Task<List<KnowledgeResultDto>> SearchAsync(string query, CancellationToken ct = default);
}
