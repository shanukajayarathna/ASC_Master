using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using Asc.Api.Modules.Agents;

namespace Asc.Api.Modules.Assistant;

public class Conversation
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid UserId { get; set; }

    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ConversationMessage
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public Guid Id { get; set; } = Guid.NewGuid();

    [BsonRepresentation(BsonType.String)]
    public Guid ConversationId { get; set; }

    /// <summary>"user" or "assistant" — only the visible text turns, never intermediate
    /// tool-call round-trips (see Modules/Assistant's own README-style comment in
    /// AssistantController for why).</summary>
    public string Role { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Which AI provider produced this turn ("openai"/"gemini"/"groq") — null on user
    /// messages. Safe, non-secret metadata; lets the UI show which vendor answered.</summary>
    public string? Provider { get; set; }

    /// <summary>Attribution kept with the answer so history retains its provenance.</summary>
    public string? Agent { get; set; }
    public List<ChatSource>? Sources { get; set; }
    [MongoDB.Bson.Serialization.Attributes.BsonRepresentation(MongoDB.Bson.BsonType.String)]
    public Guid? ReplyToClientMessageId { get; set; }
}
