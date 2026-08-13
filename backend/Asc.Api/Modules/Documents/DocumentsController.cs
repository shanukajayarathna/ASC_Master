using System.Security.Claims;
using Asc.Api.Data;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
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
public class DocumentsController(MongoContext db, IDocumentStore store, IEmbeddingProvider embeddings, IDocumentSearchService search, PlatformDocsSyncService platformDocs, IAuditLogger audit) : ControllerBase
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "pdf", "docx", "pptx", "xlsx", "xls",
    };

    private const long MaxUploadBytes = 20_000_000;

    [HttpPost]
    [RequestSizeLimit(MaxUploadBytes)]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<ActionResult<DocumentDto>> Upload(
        IFormFile file, [FromForm] string category, CancellationToken ct,
        [FromForm] DateTime? effectiveDate = null, [FromForm] DateTime? expiryDate = null, [FromForm] Guid? supersedesDocumentId = null)
    {
        if (file.Length == 0) return BadRequest("File is empty.");

        var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!AllowedExtensions.Contains(ext))
            return BadRequest($"Unsupported file type: .{ext}. Allowed: {string.Join(", ", AllowedExtensions)}");

        if (!Enum.TryParse<DocumentCategory>(category, ignoreCase: true, out var parsedCategory))
            return BadRequest($"Unknown category '{category}'. Use one of: {string.Join(", ", Enum.GetNames<DocumentCategory>())}.");

        if (supersedesDocumentId is { } supersedesId && !await db.Documents.Find(d => d.Id == supersedesId).AnyAsync(ct))
            return BadRequest("The document this is meant to supersede doesn't exist.");

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;

        var doc = new KnowledgeDocument
        {
            FileName = file.FileName,
            ContentType = file.ContentType,
            SizeBytes = file.Length,
            UploadedByUserId = userId,
            Category = parsedCategory,
            EffectiveDate = effectiveDate,
            ExpiryDate = expiryDate,
            SupersedesDocumentId = supersedesDocumentId,
        };

        // Buffered once, reused for both extraction and the eventual raw-file save —
        // IFormFile's stream isn't guaranteed cheaply re-readable, and this file is already
        // size-capped above. Each consumer gets its own MemoryStream over the same bytes
        // (not the same stream instance, rewound) because several of NPOI's format readers
        // (e.g. WorkbookFactory.Create for .xlsx/.xls) close the stream they were given when
        // the returned IWorkbook is disposed — reusing that same instance afterward throws
        // ObjectDisposedException.
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        var fileBytes = buffer.ToArray();

        var text = DocumentTextExtractor.ExtractText(new MemoryStream(fileBytes), ext);
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

        await store.SaveAsync(doc.Id, new MemoryStream(fileBytes), ext, ct);
        await db.Documents.InsertOneAsync(doc, cancellationToken: ct);

        if (chunks.Count > 0)
        {
            await db.DocumentChunks.InsertManyAsync(chunks, cancellationToken: ct);
        }

        await audit.LogAsync(User, "knowledge_document.uploaded", "Document", doc.Id.ToString(), $"{doc.FileName} ({doc.Category})", ct);
        return Ok(ToDto(doc, supersededBy: null));
    }

    [HttpGet]
    public async Task<ActionResult<List<DocumentDto>>> List(CancellationToken ct)
    {
        var docs = await db.Documents.Find(FilterDefinition<KnowledgeDocument>.Empty)
            .SortByDescending(d => d.UploadedAt)
            .ToListAsync(ct);

        // No back-reference is stored on the superseded document (see KnowledgeDocument's
        // doc comment) — computed here instead, from the same full list this endpoint
        // already loads.
        var supersededBy = docs.Where(d => d.SupersedesDocumentId.HasValue)
            .ToDictionary(d => d.SupersedesDocumentId!.Value, d => d.Id);

        return Ok(docs.Select(d => ToDto(d, supersededBy.TryGetValue(d.Id, out var by) ? by : null)).ToList());
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var doc = await db.Documents.Find(d => d.Id == id).FirstOrDefaultAsync(ct);
        await db.Documents.DeleteOneAsync(d => d.Id == id, ct);
        await db.DocumentChunks.DeleteManyAsync(c => c.DocumentId == id, ct);
        store.Delete(id);
        await audit.LogAsync(User, "knowledge_document.deleted", "Document", id.ToString(), doc?.FileName, ct);
        return NoContent();
    }

    [HttpGet("search")]
    public async Task<ActionResult<List<SearchResultDto>>> Search([FromQuery] string q, CancellationToken ct) =>
        Ok(await search.SearchAsync(q, ct));

    /// <summary>Ingest/refresh the platform's own documentation (docs/*.md) into the
    /// knowledge base — idempotent, so re-running after doc edits only re-embeds what
    /// changed. See PlatformDocsSyncService.</summary>
    [HttpPost("sync-platform-docs")]
    [Authorize(Policy = Policies.ManageKnowledgeBase)]
    public async Task<ActionResult<PlatformDocsSyncResult>> SyncPlatformDocs(CancellationToken ct)
    {
        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;
        var result = await platformDocs.SyncAsync(userId, ct);
        await audit.LogAsync(User, "knowledge_document.platform_docs_synced", "Document", null,
            $"{result.Added} added, {result.Updated} updated, {result.Unchanged} unchanged, {result.Failed.Count} failed", ct);
        return Ok(result);
    }

    private static DocumentDto ToDto(KnowledgeDocument d, Guid? supersededBy) => new(
        d.Id, d.FileName, d.ContentType, d.SizeBytes, d.UploadedAt,
        d.Category.ToString(), d.EffectiveDate, d.ExpiryDate, d.SupersedesDocumentId, supersededBy);
}
