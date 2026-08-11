using Asc.Api.Modules.Documents;

namespace Asc.Api.Modules.Knowledge;

/// <summary>Wraps the existing uploaded-document search (Modules/Documents) — embedding,
/// chunking, and cosine ranking are unchanged; this only adapts its result shape to the
/// source-agnostic KnowledgeResultDto.</summary>
public class DocumentKnowledgeSource(IDocumentSearchService documentSearch) : IKnowledgeSource
{
    public string SourceName => "Knowledge Base";

    public async Task<List<KnowledgeResultDto>> SearchAsync(string query, CancellationToken ct = default)
    {
        var results = await documentSearch.SearchAsync(query, ct);
        return results.Select(r => new KnowledgeResultDto(
            SourceName, r.DocumentFileName, r.ChunkText, r.Score, r.Category, r.DocumentId.ToString())).ToList();
    }
}
