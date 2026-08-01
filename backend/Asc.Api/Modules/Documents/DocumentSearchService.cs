using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Documents;

/// <summary>
/// The knowledge-base search logic, split out of DocumentsController so the AI assistant's
/// search_knowledge_base tool (Modules/Assistant) can call the exact same code the search
/// endpoint uses, rather than re-implementing embed-query + cosine-similarity + top-K.
/// </summary>
public interface IDocumentSearchService
{
    Task<List<SearchResultDto>> SearchAsync(string query, CancellationToken ct = default);
}

public class DocumentSearchService(MongoContext db, IEmbeddingProvider embeddings) : IDocumentSearchService
{
    /// <summary>Brute-force cosine similarity over every stored chunk — fine at the scale of an
    /// internal document library. Atlas Vector Search is the upgrade once volume justifies it.</summary>
    public async Task<List<SearchResultDto>> SearchAsync(string query, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];

        var queryVector = (await embeddings.EmbedAsync([query], ct))[0];
        var chunks = await db.DocumentChunks.Find(FilterDefinition<DocumentChunk>.Empty).ToListAsync(ct);
        if (chunks.Count == 0) return [];

        var docNames = await db.Documents.Find(FilterDefinition<KnowledgeDocument>.Empty).ToListAsync(ct);
        var nameById = docNames.ToDictionary(d => d.Id, d => d.FileName);

        return chunks
            .Select(c => new { Chunk = c, Score = CosineSimilarity(queryVector, c.Embedding) })
            .OrderByDescending(x => x.Score)
            .Take(8)
            .Where(x => nameById.ContainsKey(x.Chunk.DocumentId))
            .Select(x => new SearchResultDto(nameById[x.Chunk.DocumentId], x.Chunk.DocumentId, x.Chunk.Text, x.Score))
            .ToList();
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        double dot = 0, na = 0, nb = 0;
        for (var i = 0; i < a.Length && i < b.Length; i++)
        {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return na == 0 || nb == 0 ? 0 : dot / (Math.Sqrt(na) * Math.Sqrt(nb));
    }
}
