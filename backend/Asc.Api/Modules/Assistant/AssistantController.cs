using System.Security.Claims;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// One general assistant, grounded in the knowledge base (Phase 3) and read access to
/// catalogue/valuation data (Modules/Assistant/AssistantTools.cs), before any specialization
/// into named agents. Read-only: no tool here can edit a lot or a valuation.
/// </summary>
[ApiController]
[Route("api/v1/assistant")]
[Authorize]
public class AssistantController(MongoContext db, IChatProvider chat, AssistantToolExecutor tools) : ControllerBase
{
    private const string SystemPrompt =
        "You are the AI Assistant for Asia Siyaka Commodities' tea auction Intelligence Hub. " +
        "Answer questions about lots, valuations, and uploaded documents using the tools available " +
        "to you — you have no other source of truth about this company's data. You are strictly " +
        "read-only: you cannot edit a lot, a valuation, or any other record, and must never claim to " +
        "have done so. When you answer from a tool result, cite the specific lot number or document " +
        "name it came from. If the tools don't give you enough to answer confidently, say so plainly " +
        "rather than guessing.";

    [HttpPost("chat")]
    public async Task<ActionResult<ChatResponseDto>> Chat(ChatRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Message)) return BadRequest("Message is required.");

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;

        Conversation conversation;
        if (dto.ConversationId is { } convId)
        {
            var existing = await db.Conversations.Find(c => c.Id == convId).FirstOrDefaultAsync(ct);
            if (existing is null || existing.UserId != userId) return NotFound();
            conversation = existing;
        }
        else
        {
            conversation = new Conversation { UserId = userId, Title = TitleFrom(dto.Message) };
            await db.Conversations.InsertOneAsync(conversation, cancellationToken: ct);
        }

        var priorMessages = await db.ConversationMessages.Find(m => m.ConversationId == conversation.Id)
            .SortBy(m => m.CreatedAt).ToListAsync(ct);

        var userMessage = new ConversationMessage { ConversationId = conversation.Id, Role = "user", Content = dto.Message };
        await db.ConversationMessages.InsertOneAsync(userMessage, cancellationToken: ct);

        var history = priorMessages.Select(m => (m.Role, m.Content)).Append((userMessage.Role, userMessage.Content)).ToList();

        var reply = await chat.CompleteAsync(
            SystemPrompt, history, AssistantToolExecutor.Definitions,
            (name, args) => tools.ExecuteAsync(name, args, ct), ct);

        var assistantMessage = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = reply };
        await db.ConversationMessages.InsertOneAsync(assistantMessage, cancellationToken: ct);

        return Ok(new ChatResponseDto(conversation.Id, reply));
    }

    [HttpGet("conversations")]
    public async Task<ActionResult<List<ConversationDto>>> ListConversations(CancellationToken ct)
    {
        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;
        var list = await db.Conversations.Find(c => c.UserId == userId)
            .SortByDescending(c => c.CreatedAt).ToListAsync(ct);
        return Ok(list.Select(c => new ConversationDto(c.Id, c.Title, c.CreatedAt)).ToList());
    }

    [HttpGet("conversations/{id:guid}/messages")]
    public async Task<ActionResult<List<MessageDto>>> GetMessages(Guid id, CancellationToken ct)
    {
        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;
        var conversation = await db.Conversations.Find(c => c.Id == id).FirstOrDefaultAsync(ct);
        if (conversation is null || conversation.UserId != userId) return NotFound();

        var messages = await db.ConversationMessages.Find(m => m.ConversationId == id)
            .SortBy(m => m.CreatedAt).ToListAsync(ct);
        return Ok(messages.Select(m => new MessageDto(m.Id, m.Role, m.Content, m.CreatedAt)).ToList());
    }

    private static string TitleFrom(string message) => message.Length <= 60 ? message : message[..60] + "…";
}
