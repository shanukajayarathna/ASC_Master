using Asc.Api.Modules.Observability;
using System.Security.Claims;
using Asc.Api.Data;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;

namespace Asc.Api.Modules.Assistant;

/// <summary>
/// HTTP + conversation-persistence concerns only — the system prompt, tool wiring, and LLM
/// call live in Modules/Agents/GeneralAgent.cs, resolved through AgentRouter, so this
/// controller never talks to AiGateway directly. Read-only: no tool any agent has can edit a
/// lot or a valuation.
/// </summary>
[ApiController]
[Route("api/v1/assistant")]
[Authorize]
public class AssistantController(MongoContext db, AgentRouter agentRouter, AiGateway gateway, IAuthorizationService authorizationService, Asc.Api.Services.ICatalogueSource catalogueSource, Asc.Api.Modules.Msl.MslFilteredAnalyticsEngine analyticsEngine, CustomReportTools customTools) : ControllerBase
{
    // A real chat turn is a sentence or two; this just keeps one request from being an
    // unbounded token-cost bomb (or exceeding a provider's own input limit ungracefully) —
    // well above anything a genuine question needs, so it never affects real usage.
    private const int MaxMessageLength = 8000;

    [HttpPost("chat")]
    [EnableRateLimiting("assistantChat")]
    public async Task<ActionResult<ChatResponseDto>> Chat(ChatRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Message)) return BadRequest("Message is required.");
        if (dto.Message.Length > MaxMessageLength) return BadRequest($"Message is too long (max {MaxMessageLength} characters).");
        var catalogueOnly = string.Equals(dto.Scope?.Source, "catalogue", StringComparison.OrdinalIgnoreCase);
        var bothScoped = string.Equals(dto.Scope?.Source, "both", StringComparison.OrdinalIgnoreCase);
        var catalogueScoped = catalogueOnly || bothScoped;
        var scope = dto.Scope?.ToScope();
        if (scope?.Validate(enforceMaxYears: !catalogueOnly) is { } scopeProblem) return BadRequest(new { error = scopeProblem });
        IReadOnlyList<Guid>? catalogueScopeIds = null;
        if (catalogueScoped && scope is not null)
        {
            catalogueScopeIds = catalogueSource.ListCatalogues()
                .Select(c => (Catalogue: c, SaleNo: SalePicker.SaleNoOf(c.SourceName)))
                .Where(x => x.SaleNo is { } no && scope.Contains(x.Catalogue.Year, no))
                .Select(x => x.Catalogue.Id).ToList();
            if (catalogueOnly && catalogueScopeIds.Count == 0) return BadRequest(new { error = "No OKLO or imported sale catalogues match this Archive Scope." });
        }

        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;

        Conversation conversation;
        var retryMessage = dto.ClientMessageId is { } clientMessageId
            ? await db.ConversationMessages.Find(m => m.Id == clientMessageId && m.Role == "user").FirstOrDefaultAsync(ct)
            : null;
        if (retryMessage is not null)
        {
            var retryConversation = await db.Conversations.Find(c => c.Id == retryMessage.ConversationId).FirstOrDefaultAsync(ct);
            if (retryConversation is null || retryConversation.UserId != userId) return NotFound();
            if (!string.Equals(retryMessage.Content, dto.Message, StringComparison.Ordinal)) return Conflict(new { error = "This retry id was already used for a different message." });
            var completedRetry = await db.ConversationMessages.Find(m => m.ReplyToClientMessageId == retryMessage.Id).FirstOrDefaultAsync(ct);
            if (completedRetry is not null)
                return Ok(new ChatResponseDto(retryConversation.Id, completedRetry.Content, completedRetry.Provider ?? "router", completedRetry.Sources, completedRetry.Agent));
            conversation = retryConversation;
        }
        else if (dto.ConversationId is { } convId)
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
        if (retryMessage is not null) priorMessages = priorMessages.Where(m => m.Id != retryMessage.Id).ToList();

        var userMessage = retryMessage ?? new ConversationMessage { Id = dto.ClientMessageId ?? Guid.NewGuid(), ConversationId = conversation.Id, Role = "user", Content = dto.Message };
        if (retryMessage is null) await db.ConversationMessages.InsertOneAsync(userMessage, cancellationToken: ct);

        var history = priorMessages.Select(m => (m.Role, m.Content)).Append((userMessage.Role, userMessage.Content)).ToList();

        var isAdmin = (await authorizationService.AuthorizeAsync(User, Policies.UseAdminAiTools)).Succeeded;

        // Who is asking — only when the user has personalisation on (the default). Everything below uses just this user's own data.
        var prefs = await PersonalisationController.LoadAsync(db, userId, ct);
        var firstName = UserContext.FirstNameOf(User.FindFirstValue(ClaimTypes.Name));
        var profile = prefs.Personalise && firstName is not null
            ? new UserContext(firstName, User.FindFirstValue(ClaimTypes.Role), prefs.MyBroker)
            : null;

        // Greetings, thanks and "what can you do" are answered right here, instantly, with no language model.
        if (string.Equals(dto.Agent, IntentRouter.Auto, StringComparison.OrdinalIgnoreCase) && SmallTalk.Match(dto.Message) is { } talk)
        {
            var (recent, pinCount) = prefs.Personalise
                ? await PersonalisationController.ActivityAsync(db, userId, User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "", ct)
                : ((IReadOnlyList<string>)[], 0);
            var talkReply = new ConversationMessage
            {
                ConversationId = conversation.Id, Role = "assistant", Provider = "router", ReplyToClientMessageId = userMessage.Id,
                Content = SmallTalk.Reply(talk, prefs.Personalise ? firstName : null, dto.LocalHour, recent, pinCount),
            };
            await db.ConversationMessages.InsertOneAsync(talkReply, cancellationToken: ct);
            return Ok(new ChatResponseDto(conversation.Id, talkReply.Content, "router", null, dto.PreviousAgent));
        }
        AgentResponse response;
        Guid? lotSale = null;
        // A sale named in the question ("sale 41") is answered from that sale's catalogue even when the route picks a general agent.
        if (dto.CatalogueId is null && SalePicker.SaleNoOf(dto.Message) is null && System.Text.RegularExpressions.Regex.Match(dto.Message ?? "", @"\bsale\s*#?\s*(\d{1,2})\b") is { Success: true } namedSale)
        {
            var no = int.Parse(namedSale.Groups[1].Value);
            lotSale = catalogueSource.ListCatalogues().FirstOrDefault(c => SalePicker.SaleNoOf(c.SourceName) == no)?.Id;
        }
        ResolvedRequest? resolved = null;
        var effectiveHistory = history;
        string? answeredBy = dto.Agent;
        try
        {
            var requested = dto.Agent;
            if (string.Equals(requested, IntentRouter.Auto, StringComparison.OrdinalIgnoreCase))
            {
                // The universal chat: choose the agent (or ask one short question first) — see IntentRouter.
                var replies = priorMessages.Where(m => m.Role == "assistant").TakeLast(IntentRouter.MaxClarifications).Select(m => m.Content);

                // "Sale data" with no sale named: narrow it as a dialogue (year, then a sale number that exists), then answer on exactly that sale.
                var lastReply = priorMessages.LastOrDefault(m => m.Role == "assistant")?.Content;

                // The guided dialogue: an open-ended request is narrowed with buttons built from data that exists, then answered exactly as chosen.
                var openTurns = GuidedIntake.OpenTurns([.. priorMessages.Select(m => (m.Role, m.Content, (string?)m.Provider))], dto.Message);
                if (!catalogueScoped && GuidedIntake.Involved(openTurns))
                {
                    var (intakeData, catalogueIds) = await LoadIntakeDataAsync(prefs.MyBroker, ct);
                    if (GuidedIntake.Next(openTurns, intakeData, hasScope: scope is not null) is { } outcome)
                    {
                        if (outcome.Ask is { } intakeQuestion || outcome.Lead is not null)
                        {
                            var text = outcome.Ask is { } q2 ? IntentRouter.ClarifyReply(q2, outcome.Lead) : outcome.Lead!;
                            var intakeAsk = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = text, Provider = "router", Agent = "analytics", ReplyToClientMessageId = userMessage.Id };
                            await db.ConversationMessages.InsertOneAsync(intakeAsk, cancellationToken: ct);
                            return Ok(new ChatResponseDto(conversation.Id, text, "router", null, "analytics"));
                        }
                        if (outcome.Resolved is { } done)
                        {
                            resolved = done;
                            if (done.Scope is not null) scope = done.Scope;
                            if (done.CatalogueSale is { } cat) lotSale = catalogueIds.GetValueOrDefault(cat);
                            // one clear request for the model, instead of the button-tapping turns (fewer tokens, no confusion)
                            var first = openTurns.First(m => m.Role == "user").Content;
                            effectiveHistory = [.. history.Take(history.Count - openTurns.Count), ("user", $"{first} — {done.Summary()}")];

                            // Everything is chosen and the archive can answer it: the server answers itself — exact, instant, no model, no tokens.
                            if (DirectAnswer.CanAnswer(done, scope))
                            {
                                var (preview, _) = await customTools.PreviewAsync(DirectAnswer.ToArgs(done, scope!), ct);
                                if (preview is not null && DirectAnswer.Reply(done, preview) is { } direct)
                                {
                                    var directSources = (IReadOnlyList<ChatSource>)[new ChatSource("archive", "MSL auction archive")];
                                    var directMessage = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = direct, Provider = "direct", Agent = "analytics", Sources = directSources.ToList(), ReplyToClientMessageId = userMessage.Id };
                                    await db.ConversationMessages.InsertOneAsync(directMessage, cancellationToken: ct);
                                    return Ok(new ChatResponseDto(conversation.Id, direct, "direct", directSources, "analytics"));
                                }
                            }
                        }
                    }
                }

                // Lot lists (any broker, grade, elevation, category or factory / mark / buyer): a table built from the sale's lots, with no model.
                if (LotListAnswer.Asks(dto.Message))
                {
                    var listCatalogue = catalogueSource.ListCatalogues().FirstOrDefault(c => c.Id == (lotSale ?? catalogueSource.ListCatalogues().FirstOrDefault()?.Id));
                    var listLots = listCatalogue is null ? [] : (catalogueSource.GetLots(listCatalogue.Id) ?? []);
                    var listReply = LotListAnswer.Reply(dto.Message, listLots, NameIndex.From(listLots), listCatalogue?.SourceName ?? "the latest sale");
                    if (listReply is not null)
                    {
                        var listMessage = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = listReply, Provider = "direct" };
                        await db.ConversationMessages.InsertOneAsync(listMessage, cancellationToken: ct);
                        return Ok(new ChatResponseDto(conversation.Id, listReply, "direct", null, "auction"));
                    }
                }

                // Factory codes: answered from the sale's lots, with no model (and a misspelt name is confirmed, not guessed).
                if (FactoryLookup.Asks(dto.Message))
                {
                    var codeCatalogue = catalogueSource.ListCatalogues().FirstOrDefault(c => c.Id == (lotSale ?? catalogueSource.ListCatalogues().FirstOrDefault()?.Id));
                    var codeLots = codeCatalogue is null ? [] : (catalogueSource.GetLots(codeCatalogue.Id) ?? []);
                    var codeReply = FactoryLookup.Reply(dto.Message, NameIndex.From(codeLots), codeCatalogue?.SourceName ?? "the latest sale");
                    if (codeReply is not null)
                    {
                        var codeMessage = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = codeReply, Provider = "direct" };
                        await db.ConversationMessages.InsertOneAsync(codeMessage, cancellationToken: ct);
                        return Ok(new ChatResponseDto(conversation.Id, codeReply, "direct", null, "auction"));
                    }
                }

                // Names (factory, mark, buyer): when one could be more than one of them, ask which, and never guess.
                var nameAnswer = NameAnswerIn(lastReply, dto.Message);
                if (nameAnswer is null && resolved is null)
                {
                    var names = (await NameIndexAsync(ct)).Find(dto.Message);
                    var ambiguous = names.FirstOrDefault(n => n.Kinds.Count > 1);
                    if (ambiguous is not null)
                    {
                        var kindWords = ambiguous.Kinds.Select(KindLabel).ToList();
                        var nameQuestion = $"Is {ambiguous.Name} a {string.Join(", a ", kindWords.Take(kindWords.Count - 1))}{(kindWords.Count > 1 ? " or a " : "a ")}{kindWords[^1]}?";
                        var nameAsk = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = IntentRouter.ClarifyReply(new ClarifyQuestion(nameQuestion, [.. kindWords]), null), Provider = "router" };
                        await db.ConversationMessages.InsertOneAsync(nameAsk, cancellationToken: ct);
                        return Ok(new ChatResponseDto(conversation.Id, nameAsk.Content, "router", null, "auction"));
                    }
                    if (names.FirstOrDefault(n => n.Kinds.Count == 1) is { } known)
                        effectiveHistory = [.. effectiveHistory.Take(effectiveHistory.Count - 1), ("user", $"{dto.Message} ({known.Name} is a {KindLabel(known.Kinds[0])}: match that column)")];
                }
                else if (nameAnswer is not null)
                    effectiveHistory = [.. effectiveHistory.Take(effectiveHistory.Count - 1), ("user", $"{dto.Message} ({nameAnswer.Value.Name} is a {KindLabel(nameAnswer.Value.Kind)}: match that column)")];

                if (!catalogueScoped && resolved is null && scope is null && SalePicker.Involved(dto.Message, lastReply))
                {
                    // Sales that exist = the archive plus the sale catalogues (which run ahead of the archive, e.g. the current sale).
                    var available = await db.MslSaleStats.Find(x => x.Dimension == "total" && x.SaleNo > 0).Project(x => new { x.Year, x.SaleNo }).ToListAsync(ct);
                    var archived = available.Select(x => (x.Year, x.SaleNo)).ToHashSet();
                    var fromCatalogues = catalogueSource.ListCatalogues()
                        .Select(x => (Cat: x, No: SalePicker.SaleNoOf(x.SourceName))).Where(x => x.No is not null)
                        .ToList();
                    var everything = archived.Concat(fromCatalogues.Select(x => (x.Cat.Year, x.No!.Value))).Distinct().ToList();
                    if (SalePicker.Next(dto.Message, lastReply, everything) is { } pick)
                    {
                        if (pick.Ask is { } pickQuestion)
                        {
                            var pickAsk = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = IntentRouter.ClarifyReply(pickQuestion), Provider = "router", Agent = "analytics", ReplyToClientMessageId = userMessage.Id };
                            await db.ConversationMessages.InsertOneAsync(pickAsk, cancellationToken: ct);
                            return Ok(new ChatResponseDto(conversation.Id, pickAsk.Content, "router", null, "analytics"));
                        }
                        // A sale the archive doesn't have yet is answered from its catalogue (lots and valuations) instead.
                        if (pick.Chosen is { FromYear: var cy, FromSale: { } cs } && !archived.Contains((cy, cs)))
                            lotSale = fromCatalogues.FirstOrDefault(x => x.Cat.Year == cy && x.No == cs).Cat?.Id;
                        else
                            scope = pick.Chosen;
                    }
                }

                // A lot question with no sale on screen: ask which sale's catalogue (only ones that exist), then answer from that one.
                if (!catalogueScoped && resolved is null && dto.CatalogueId is null && scope is null && LotSalePicker.Involved(dto.Message, lastReply))
                {
                    var known = catalogueSource.ListCatalogues().Select(x => (x.Id, x.SourceName)).ToList();
                    if (LotSalePicker.Next(dto.Message, lastReply, known) is { } lotPick)
                    {
                        if (lotPick.Ask is { } lotQuestion)
                        {
                            var lotAsk = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = IntentRouter.ClarifyReply(lotQuestion), Provider = "router", Agent = "auction", ReplyToClientMessageId = userMessage.Id };
                            await db.ConversationMessages.InsertOneAsync(lotAsk, cancellationToken: ct);
                            return Ok(new ChatResponseDto(conversation.Id, lotAsk.Content, "router", null, "auction"));
                        }
                        lotSale = lotPick.Chosen;
                    }
                }

                var lastUser = priorMessages.LastOrDefault(m => m.Role == "user")?.Content;
                var decision = resolved is not null
                    ? new RouteDecision(resolved.AgentKey, null, "guided request resolved")
                    : lotSale is not null
                    ? new RouteDecision("auction", null, "sale chosen for a lot question")
                    : scope is not null && SaleScopeChosenThisTurn(lastReply)
                    ? new RouteDecision("analytics", null, "sale chosen in the dialogue")
                    : IntentRouter.Decide(dto.Message, dto.PreviousAgent, replies, lastUser, hasScope: scope is not null);
                if (bothScoped) decision = new RouteDecision("analytics", null, "both sale data sources selected");
                else if (catalogueScoped) decision = new RouteDecision("auction", null, "sale catalogue scope selected");
                answeredBy = decision.Agent;
                if (decision.Clarify is { } question)
                {
                    var ask = new ConversationMessage { ConversationId = conversation.Id, Role = "assistant", Content = IntentRouter.ClarifyReply(question), Provider = "router", Agent = decision.Agent, ReplyToClientMessageId = userMessage.Id };
                    await db.ConversationMessages.InsertOneAsync(ask, cancellationToken: ct);
                    return Ok(new ChatResponseDto(conversation.Id, ask.Content, "router", null, decision.Agent));
                }
                requested = decision.Agent;
            }

            if (catalogueScoped && !bothScoped) answeredBy = requested = "auction";
            if (bothScoped)
            {
                var archivedSales = await db.MslSaleStats.Find(x => x.Dimension == "total" && x.SaleNo > 0)
                    .Project(x => new { x.Year, x.SaleNo }).ToListAsync(ct);
                var includeArchive = archivedSales.Any(x => scope is null || scope.Contains(x.Year, x.SaleNo));
                var parts = new List<string>();
                var combinedSources = new List<ChatSource>();
                var combinedToolOutputs = new List<string>();
                var providers = new List<string>();
                if (includeArchive)
                {
                    var analytics = agentRouter.Resolve("analytics");
                    AgentResponse archiveResponse;
                    using (AiUsageScope.Begin(analytics.Key))
                        archiveResponse = await analytics.HandleAsync(new AgentRequest(dto.Message, ContextBudget.Compact(effectiveHistory), dto.Provider, isAdmin, Scope: scope, User: profile, Resolved: resolved), ct);
                    parts.Add("**MSL archive results**\n" + archiveResponse.Reply);
                    if (archiveResponse.Sources is not null) combinedSources.AddRange(archiveResponse.Sources);
                    if (archiveResponse.ToolOutputs is not null) combinedToolOutputs.AddRange(archiveResponse.ToolOutputs);
                    providers.Add(archiveResponse.ProviderKey);
                }
                if (catalogueScopeIds is { Count: > 0 })
                {
                    var auction = agentRouter.Resolve("auction");
                    AgentResponse catalogueResponse;
                    using (AiUsageScope.Begin(auction.Key))
                        catalogueResponse = await auction.HandleAsync(new AgentRequest(dto.Message, ContextBudget.Compact(effectiveHistory), dto.Provider, isAdmin, Scope: scope, User: profile, CatalogueScopeIds: catalogueScopeIds), ct);
                    parts.Add("**OKLO / imported sale catalogues**\n" + catalogueResponse.Reply);
                    if (catalogueResponse.Sources is not null) combinedSources.AddRange(catalogueResponse.Sources);
                    if (catalogueResponse.ToolOutputs is not null) combinedToolOutputs.AddRange(catalogueResponse.ToolOutputs);
                    providers.Add(catalogueResponse.ProviderKey);
                }
                if (parts.Count == 0) return BadRequest(new { error = "No MSL results or sale catalogues match this Archive Scope." });
                response = new AgentResponse(string.Join("\n\n", parts), string.Join("+", providers), combinedSources, combinedToolOutputs);
                answeredBy = parts.Count > 1 ? "analytics" : includeArchive ? "analytics" : "auction";
            }
            else
            {
                var agent = agentRouter.Resolve(requested);
                using var usage = AiUsageScope.Begin(agent.Key); // so each AI call is logged against this agent
                response = await agent.HandleAsync(new AgentRequest(dto.Message, ContextBudget.Compact(effectiveHistory), dto.Provider, isAdmin, lotSale ?? dto.CatalogueId, scope, profile, resolved, catalogueScopeIds), ct);
            }
        }
        catch (UnknownAgentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (ProviderUnavailableException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex) when (ex is TaskCanceledException or TimeoutException && !ct.IsCancellationRequested)
        {
            // The model provider didn't answer in time (a local CPU model on a busy machine can take many minutes).
            return StatusCode(StatusCodes.Status504GatewayTimeout, new { error = "The AI model took too long to answer. Try again, narrow the question, or pick a faster provider (the Local model is for testing only)." });
        }

        // Any larger figure the model wrote that its own tool results don't contain gets a short caution under the answer.
        // A by-law answer is only shown when the question was about by-laws; otherwise the route went wrong and the reader is told so.
        var bylawAnswer = response.Sources?.Any(x => x.Kind == "bylaws") ?? false;
        var bylawQuestion = System.Text.RegularExpressions.Regex.IsMatch(dto.Message ?? "", @"\b(by-?laws?|ctta|deposit|penalt\w*|prompt day|debar\w*|claims?|storage|objection|bid|reserve)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var checkedReply = (bylawAnswer && !bylawQuestion) || AnswerVerifier.IsNarratedToolCall(response.Reply, response.ToolOutputs ?? [])
            ? AnswerVerifier.CouldNotLookUp
            : AnswerVerifier.Annotate(response.Reply, response.ToolOutputs ?? []);
        response = response with { Reply = checkedReply };

        var assistantMessage = new ConversationMessage
        {
            ConversationId = conversation.Id, Role = "assistant", Content = response.Reply, Provider = response.ProviderKey,
            Sources = response.Sources?.ToList(), Agent = answeredBy, ReplyToClientMessageId = userMessage.Id,
        };
        await db.ConversationMessages.InsertOneAsync(assistantMessage, cancellationToken: ct);

        return Ok(new ChatResponseDto(conversation.Id, response.Reply, response.ProviderKey, response.Sources, answeredBy));
    }

    /// <summary>What exists to choose from: archive sales, catalogue sales (with their ids), every grade, and the top grades of the latest archive sale.</summary>
    private static string KindLabel(NameKind k) => k switch { NameKind.Factory => "factory", NameKind.Mark => "mark", _ => "buyer" };

    /// <summary>The user's answer to "Is X a factory, a mark or a buyer?" — the name and the kind — or null.</summary>
    private static (string Name, NameKind Kind)? NameAnswerIn(string? lastReply, string answer)
    {
        var asked = lastReply is null ? System.Text.RegularExpressions.Match.Empty : System.Text.RegularExpressions.Regex.Match(lastReply, @"^Is (.+?) a (?:factory|mark|buyer).*?");
        if (!asked.Success) return null;
        var name = asked.Groups[1].Value;
        var kind = answer.Trim().ToLowerInvariant() switch { "factory" => NameKind.Factory, "mark" => NameKind.Mark, "buyer" => NameKind.Buyer, _ => (NameKind?)null };
        return kind is null || name.Length == 0 ? null : (name, kind.Value);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, NameIndex Index)> NameIndexCache = new();

    /// <summary>Names of the newest sale's lots, cached for a few minutes.</summary>
    private async Task<NameIndex> NameIndexAsync(CancellationToken ct)
    {
        const string key = "names:latest";
        if (NameIndexCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < TimeSpan.FromMinutes(5)) return hit.Index;
        var newest = catalogueSource.ListCatalogues().FirstOrDefault();
        var lots = newest is null ? [] : (catalogueSource.GetLots(newest.Id) ?? []);
        var index = NameIndex.From(lots);
        NameIndexCache[key] = (DateTime.UtcNow, index);
        return index;
    }

    /// <summary>The guided options change only when a sale is imported, so they are reused for a few minutes instead of querying the archive on every message.</summary>
    private static readonly TimeSpan IntakeTtl = TimeSpan.FromMinutes(5);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime At, (IntakeData Data, Dictionary<(int Year, int SaleNo), Guid> CatalogueIds) Value)> IntakeCache = new();

    private async Task<(IntakeData Data, Dictionary<(int Year, int SaleNo), Guid> CatalogueIds)> LoadIntakeDataAsync(string myBroker, CancellationToken ct)
    {
        var key = "intake:" + myBroker;
        if (IntakeCache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.At < IntakeTtl) return hit.Value;
        var loaded = await LoadIntakeDataUncachedAsync(myBroker, ct);
        IntakeCache[key] = (DateTime.UtcNow, loaded);
        return loaded;
    }

    private async Task<(IntakeData Data, Dictionary<(int Year, int SaleNo), Guid> CatalogueIds)> LoadIntakeDataUncachedAsync(string myBroker, CancellationToken ct)
    {
        var stats = await db.MslSaleStats.Find(x => x.Dimension == "total" && x.SaleNo > 0).Project(x => new { x.Year, x.SaleNo }).ToListAsync(ct);
        var archived = stats.Select(x => (x.Year, x.SaleNo)).Distinct().ToList();
        var ids = new Dictionary<(int Year, int SaleNo), Guid>();
        foreach (var c in catalogueSource.ListCatalogues())
            if (SalePicker.SaleNoOf(c.SourceName) is { } no) ids[(c.Year, no)] = c.Id;

        var allGrades = (await analyticsEngine.LightweightOptionsAsync(ct)).Grades;
        var top = new List<string>();
        if (archived.Count > 0)
        {
            var (y, n) = archived.OrderByDescending(a => a.Year).ThenByDescending(a => a.SaleNo).First();
            top = await db.MslSaleStats.Find(x => x.Dimension == "grade" && x.Year == y && x.SaleNo == n)
                .SortByDescending(x => x.SoldQtyKg).Limit(8).Project(x => x.Key).ToListAsync(ct);
        }
        return (new IntakeData(archived, [.. ids.Keys], allGrades, top, myBroker), ids);
    }

    /// <summary>The previous message was the picker's "which sale" question, so this turn's scope came from the dialogue.</summary>
    private static bool SaleScopeChosenThisTurn(string? lastReply) =>
        lastReply is not null && (lastReply.StartsWith(SalePicker.SaleQuestionPrefix, StringComparison.Ordinal) || lastReply.StartsWith(SalePicker.YearQuestion, StringComparison.Ordinal));

    [HttpGet("providers")]
    public ActionResult<List<ProviderStatusDto>> GetProviders() => Ok(gateway.GetStatuses());

    /// <summary>Dev/test capability to run the same message through several providers at once —
    /// gated to Admin since this is a diagnostic surface, not part of normal chat usage.
    /// Stateless: nothing here touches conversation persistence.</summary>
    [HttpPost("compare")]
    [Authorize(Policy = Policies.UseAdminAiTools)]
    [EnableRateLimiting("assistantChat")]
    public async Task<ActionResult<List<CompareResultDto>>> Compare(CompareRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Message)) return BadRequest("Message is required.");
        if (dto.Message.Length > MaxMessageLength) return BadRequest($"Message is too long (max {MaxMessageLength} characters).");

        var statuses = gateway.GetStatuses();
        var keys = dto.Providers?.Count > 0
            ? dto.Providers
            : statuses.Where(s => s.Configured).Select(s => s.Key).ToList();

        var history = new List<(string Role, string Content)> { ("user", dto.Message) };
        var results = new List<CompareResultDto>();
        var agent = agentRouter.Resolve(null);

        // Sequential, not parallel — keeps SaleFileStore's shared LRU cache and gateway log
        // ordering sane for a manual dev/test button; this endpoint isn't on a latency-sensitive path.
        foreach (var key in keys)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var response = await agent.HandleAsync(new AgentRequest(dto.Message, history, key, true), ct);
                results.Add(new CompareResultDto(key, true, response.Reply, sw.ElapsedMilliseconds, null));
            }
            catch (ProviderUnavailableException ex)
            {
                results.Add(new CompareResultDto(key, false, null, sw.ElapsedMilliseconds, ex.Message));
            }
        }

        return Ok(results);
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
        return Ok(messages.Select(m => new MessageDto(m.Id, m.Role, m.Content, m.CreatedAt, m.Provider, m.Sources, m.Agent)).ToList());
    }

    [HttpDelete("conversations/{id:guid}")]
    public async Task<IActionResult> DeleteConversation(Guid id, CancellationToken ct)
    {
        var userId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;
        var conversation = await db.Conversations.Find(c => c.Id == id).FirstOrDefaultAsync(ct);
        if (conversation is null || conversation.UserId != userId) return NotFound();

        await db.ConversationMessages.DeleteManyAsync(m => m.ConversationId == id, ct);
        await db.Conversations.DeleteOneAsync(c => c.Id == id, ct);
        return NoContent();
    }

    private static string TitleFrom(string message) => message.Length <= 60 ? message : message[..60] + "…";
}
