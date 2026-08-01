using System.Security.Claims;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Documents;

/// <summary>
/// Ingestion + search for the knowledge base — the substrate the AI Assistant phase will
/// query. No chat/summarization here, just: upload, extract, chunk, embed, search.
/// Unlike the pre-existing api/... controllers (deliberately left open for now), every action
/// here requires login — there's no legacy behavior to preserve on a brand-new module.
/// </summary>
[ApiController]
[Route("api/v1/documents")]
[Authorize]
public class DocumentsController(MongoContext db, IDocumentStore store, IEmbeddingProvider embeddings) : ControllerBase
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "pdf", "docx", "pptx", "xlsx", "xls",
    };

    private const long MaxUploadBytes = 20_000_000;

    [HttpPost]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<DocumentDto>> Upload(IFormFile file, CancellationToken ct)
    {
        if (file.Length == 0) return BadRequest("File is empty.");

        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!AllowedExtensions.Contains(ext))
            return BadRequest($"Unsupported file type: .{ext}. Allowed: {string.Join(", ", AllowedExtensions)}");

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;

        var doc = new KnowledgeDocument
        {
            FileName = file.FileName,
            ContentType = file.ContentType,
            SizeBytes = file.Length,
            UploadedByUserId = userId,
        };

        // Buffered once, reused for both extraction and the eventual raw-file save —
        // IFormFile's stream isn't guaranteed cheaply re-readable, and this file is already
        // size-capped above.
        await using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);

        buffer.Position = 0;
        var text = DocumentTextExtractor.ExtractText(buffer, ext);
        var chunkTexts = DocumentTextExtractor.Chunk(text);

        // Embed *before* persisting anything — this is the step most likely to fail (missing
        // API key, network, rate limit), and it's pure computation up to here. Persisting
        // first and embedding after would leave an orphaned document with zero chunks,
        // indistinguishable from "genuinely had no extractable text", on every such failure.
        var chunks = new List<DocumentChunk>();
        if (chunkTexts.Count > 0)
        {
            var vectors = await embeddings.EmbedAsync(chunkTexts, ct);
            chunks = chunkTexts.Select((t, i) => new DocumentChunk
            {
                DocumentId = doc.Id,
                ChunkIndex = i,
                Text = t,
                Embedding = vectors[i],
            }).ToList();
        }

        buffer.Position = 0;
        await store.SaveAsync(doc.Id, buffer, ext, ct);
        await db.Documents.InsertOneAsync(doc, cancellationToken: ct);

        if (chunks.Count > 0)
        {
            await db.DocumentChunks.InsertManyAsync(chunks, cancellationToken: ct);
        }

        return Ok(ToDto(doc));
    }

    [HttpGet]
    public async Task<ActionResult<List<DocumentDto>>> List(CancellationToken ct)
    {
        var docs = await db.Documents.Find(FilterDefinition<KnowledgeDocument>.Empty)
            .SortByDescending(d => d.UploadedAt)
            .ToListAsync(ct);
        return Ok(docs.Select(ToDto).ToList());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await db.Documents.DeleteOneAsync(d => d.Id == id, ct);
        await db.DocumentChunks.DeleteManyAsync(c => c.DocumentId == id, ct);
        store.Delete(id);
        return NoContent();
    }

    /// <summary>Brute-force cosine similarity over every stored chunk — fine at the scale of an
    /// internal document library. Atlas Vector Search is the upgrade once volume justifies it.</summary>
    [HttpGet("search")]
    public async Task<ActionResult<List<SearchResultDto>>> Search([FromQuery] string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q)) return Ok(new List<SearchResultDto>());

        var queryVector = (await embeddings.EmbedAsync([q], ct))[0];
        var chunks = await db.DocumentChunks.Find(FilterDefinition<DocumentChunk>.Empty).ToListAsync(ct);
        if (chunks.Count == 0) return Ok(new List<SearchResultDto>());

        var docNames = await db.Documents.Find(FilterDefinition<KnowledgeDocument>.Empty).ToListAsync(ct);
        var nameById = docNames.ToDictionary(d => d.Id, d => d.FileName);

        var results = chunks
            .Select(c => new { Chunk = c, Score = CosineSimilarity(queryVector, c.Embedding) })
            .OrderByDescending(x => x.Score)
            .Take(8)
            .Where(x => nameById.ContainsKey(x.Chunk.DocumentId))
            .Select(x => new SearchResultDto(nameById[x.Chunk.DocumentId], x.Chunk.DocumentId, x.Chunk.Text, x.Score))
            .ToList();

        return Ok(results);
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

    private static DocumentDto ToDto(KnowledgeDocument d) => new(d.Id, d.FileName, d.ContentType, d.SizeBytes, d.UploadedAt);
}
