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
    /// internal document library. Atlas Vector Search is the upgrade once volume justifies it.
    /// A chunk whose document is superseded or outside its effective window is excluded
    /// before ranking (not after Take(8)) so it can never crowd out a genuinely current
    /// result — see IsCurrentlyVisible.</summary>
    public async Task<List<SearchResultDto>> SearchAsync(string query, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];

        var queryVector = (await embeddings.EmbedAsync([query], ct))[0];
        var chunks = await db.DocumentChunks.Find(FilterDefinition<DocumentChunk>.Empty).ToListAsync(ct);
        if (chunks.Count == 0) return [];

        var docs = await db.Documents.Find(FilterDefinition<KnowledgeDocument>.Empty).ToListAsync(ct);
        var docsById = docs.ToDictionary(d => d.Id);
        var supersededIds = docs.Where(d => d.SupersedesDocumentId.HasValue)
            .Select(d => d.SupersedesDocumentId!.Value).ToHashSet();

        var now = DateTime.UtcNow;
        var visibleChunks = chunks.Where(c =>
            docsById.TryGetValue(c.DocumentId, out var doc) && IsCurrentlyVisible(doc, supersededIds.Contains(doc.Id), now));

        return visibleChunks
            .Select(c => new { Chunk = c, Doc = docsById[c.DocumentId], Score = CosineSimilarity(queryVector, c.Embedding) })
            .OrderByDescending(x => x.Score)
            .Take(8)
            .Select(x => new SearchResultDto(x.Doc.FileName, x.Chunk.DocumentId, x.Chunk.Text, x.Score, x.Doc.Category.ToString()))
            .ToList();
    }

    /// <summary>Pure so it's unit-testable without Mongo — see Asc.Api.Tests.</summary>
    internal static bool IsCurrentlyVisible(KnowledgeDocument doc, bool isSuperseded, DateTime now)
    {
        if (isSuperseded) return false;
        if (doc.EffectiveDate.HasValue && doc.EffectiveDate.Value > now) return false;
        if (doc.ExpiryDate.HasValue && doc.ExpiryDate.Value < now) return false;
        return true;
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
