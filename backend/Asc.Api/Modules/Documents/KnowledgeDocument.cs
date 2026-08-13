using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Asc.Api.Modules.Documents;

/// <summary>Internal = 0 deliberately: every document uploaded before this field existed
/// deserializes to Internal (a conservative "not yet classified" default), never to
/// Authoritative.</summary>
public enum DocumentCategory
{
    Internal,
    Authoritative,
    Reference,
    Training,
    External,
    Temporary,
}

public class KnowledgeDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }

    [BsonRepresentation(BsonType.String)]
    public Guid UploadedByUserId { get; set; }

    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;

    [BsonRepresentation(BsonType.String)]
    public DocumentCategory Category { get; set; } = DocumentCategory.Internal;

    /// <summary>When this document's guidance starts/stops applying — both optional, since
    /// most documents (training material, general reference) have no such window. Search
    /// excludes a document outside this window; see DocumentSearchService.IsCurrentlyVisible.</summary>
    public DateTime? EffectiveDate { get; set; }
    public DateTime? ExpiryDate { get; set; }

    /// <summary>Set when this document is a new version of an existing one — points at the
    /// old document, which stays in the database (never deleted by superseding) but drops
    /// out of search. No back-reference is stored on the old document; "superseded by" is
    /// computed at read time (see DocumentsController.List) to avoid a second write.</summary>
    [BsonRepresentation(BsonType.String)]
    public Guid? SupersedesDocumentId { get; set; }

    /// <summary>SHA-256 of the source text, set only by PlatformDocsSyncService — lets a
    /// re-sync skip unchanged files instead of re-embedding them. Null for uploads (they
    /// have no re-sync path, so nothing would ever compare against it).</summary>
    public string? ContentHash { get; set; }
}

public class DocumentChunk
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid DocumentId { get; set; }

    public int ChunkIndex { get; set; }
    public string Text { get; set; } = string.Empty;
    public float[] Embedding { get; set; } = [];
}
