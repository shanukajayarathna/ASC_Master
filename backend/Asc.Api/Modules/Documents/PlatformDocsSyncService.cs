using System.Security.Cryptography;
using System.Text;
using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Documents;

/// <summary>Outcome of one sync pass — every file accounted for in exactly one bucket.</summary>
public record PlatformDocsSyncResult(int Added, int Updated, int Unchanged, List<string> Failed);

/// <summary>
/// Ingests the platform's own documentation (docs/*.md — the module guides the assistant is
/// otherwise blind to) into the existing knowledge base, through the exact same chunk +
/// embed + documents/documentChunks pipeline uploads use. Not a new knowledge source: the
/// docs become ordinary KnowledgeDocuments (category Reference), so search_knowledge_base,
/// the Knowledge page and DocumentKnowledgeSource all see them with zero changes.
///
/// Idempotent by design: each file's document id is deterministic (MD5 of its name, the
/// SaleFileStore identity pattern), and a stored content hash skips re-embedding files that
/// haven't changed — re-running the sync costs nothing when nothing moved, and an edited
/// doc is replaced in place (same id, fresh chunks) rather than duplicated. One unreadable
/// or unembeddable file lands in Failed without stopping the rest of the pass.
/// </summary>
public class PlatformDocsSyncService(MongoContext db, IDocumentStore store, IEmbeddingProvider embeddings, IWebHostEnvironment env, ILogger<PlatformDocsSyncService> logger)
{
    public string DocsDir => Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "docs"));

    /// <summary>Same-name file ⇒ same document id forever — this is what makes a re-sync
    /// replace a doc instead of duplicating it. Name is case-normalized so a rename that
    /// only changes casing doesn't orphan the old document.</summary>
    public static Guid DocumentIdFor(string fileName) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes($"platform-doc:{fileName.ToLowerInvariant()}")));

    public static string ContentHashOf(string text) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    public async Task<PlatformDocsSyncResult> SyncAsync(Guid triggeredByUserId, CancellationToken ct = default)
    {
        if (!Directory.Exists(DocsDir))
            throw new DirectoryNotFoundException($"Platform docs folder not found: {DocsDir}");

        int added = 0, updated = 0, unchanged = 0;
        var failed = new List<string>();

        // Top level only — docs/assets holds images, and any future subfolder would need its
        // own decision about whether it belongs in the knowledge base.
        foreach (var path in Directory.GetFiles(DocsDir, "*.md").OrderBy(p => p))
        {
            ct.ThrowIfCancellationRequested();
            var fileName = Path.GetFileName(path);
            try
            {
                var text = await File.ReadAllTextAsync(path, ct);
                var id = DocumentIdFor(fileName);
                var hash = ContentHashOf(text);

                var existing = await db.Documents.Find(d => d.Id == id).FirstOrDefaultAsync(ct);
                if (existing?.ContentHash == hash)
                {
                    unchanged++;
                    continue;
                }

                // Embed before persisting anything, same as the upload path — an embedding
                // failure must leave the previous version of the doc fully intact.
                var chunkTexts = DocumentTextExtractor.Chunk(text);
                var vectors = chunkTexts.Count > 0 ? await embeddings.EmbedAsync(chunkTexts, ct) : [];
                var chunks = chunkTexts.Select((t, i) => new DocumentChunk
                {
                    DocumentId = id,
                    ChunkIndex = i,
                    Text = t,
                    Embedding = vectors[i],
                }).ToList();

                var doc = new KnowledgeDocument
                {
                    Id = id,
                    FileName = fileName,
                    ContentType = "text/markdown",
                    SizeBytes = Encoding.UTF8.GetByteCount(text),
                    UploadedByUserId = triggeredByUserId,
                    UploadedAt = DateTime.UtcNow,
                    Category = DocumentCategory.Reference,
                    ContentHash = hash,
                };

                await store.SaveAsync(id, new MemoryStream(Encoding.UTF8.GetBytes(text)), "md", ct);
                await db.Documents.ReplaceOneAsync(d => d.Id == id, doc, new ReplaceOptions { IsUpsert = true }, ct);
                await db.DocumentChunks.DeleteManyAsync(c => c.DocumentId == id, ct);
                if (chunks.Count > 0)
                    await db.DocumentChunks.InsertManyAsync(chunks, cancellationToken: ct);

                if (existing is null) added++;
                else updated++;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Platform doc sync failed for {FileName}", fileName);
                failed.Add($"{fileName}: {ex.Message}");
            }
        }

        return new PlatformDocsSyncResult(added, updated, unchanged, failed);
    }
}
