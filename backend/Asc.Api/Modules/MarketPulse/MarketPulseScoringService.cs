using System.Text.Json;
using System.Text.Json.Serialization;
using Asc.Api.Modules.Assistant;

namespace Asc.Api.Modules.MarketPulse;

/// <summary>One item handed to the AI to score — title/summary only, the sole material the
/// prompt grounds itself in.</summary>
public record MarketPulseScoringInput(int Index, string Title, string Summary);

public record MarketPulseScoringResult(int Index, int RelevanceScore, MarketPulseCategory Category, string WhyItMatters);

/// <summary>
/// Batches new items into one AI call per ingestion cycle (never one call per article —
/// see the module's cost-discipline principle) and asks for a strict JSON array back, one
/// scored result per input item. Grounded, not generative: the prompt only ever gives the
/// model each item's own title/summary and forbids using outside knowledge, so
/// <see cref="MarketPulseScoringResult.WhyItMatters"/> can only restate what's already in
/// the source material, never invent a fact.
///
/// Tries every configured provider in turn (see <see cref="ProviderOrder"/>) rather than
/// just the AiGateway default — AiGateway itself deliberately does *not* fall back across
/// providers (see its own doc comment), but this module's "degrade gracefully" requirement
/// explicitly wants the OpenAI → Gemini → Groq → Ollama chain, so the fallback loop lives
/// here instead. Returns an empty list (never throws) when every provider fails or is
/// unconfigured — callers treat that as "leave these items Pending, try again next cycle."
/// </summary>
public class MarketPulseScoringService(AiGateway gateway, ILogger<MarketPulseScoringService> logger)
{
    private static readonly string[] ProviderOrder = ["openai", "gemini", "groq", "local"];

    /// <summary>Bounds each individual provider attempt, independent of that provider's own
    /// registered HttpClient.Timeout (Local/Ollama's is 10 minutes — fine for a single
    /// assistant turn, far too long to let one slow provider block an entire ingestion
    /// cycle 4 times over). A batch this size normally scores in well under this on a real
    /// hosted API; a local model too slow to keep up just gets skipped this cycle, same as
    /// any other unavailable provider.</summary>
    private static readonly TimeSpan PerProviderTimeout = TimeSpan.FromSeconds(90);

    private const string SystemPrompt = """
        You score news items for relevance to a Ceylon (Sri Lankan) tea auction brokerage.
        You will be given a JSON array of items, each with an "index", "title" and "summary".
        For EVERY item in the input, return one scored result. Use ONLY the title and summary
        given — never use outside knowledge, never assume facts not stated in them, and never
        invent details. If the summary is too thin to say anything specific, say so plainly
        rather than filling in a guess.

        Relevant topics (score higher when an item clearly touches one of these):
        - Tea market conditions: Ceylon/global tea prices, auction results, demand/supply
        - Shipping & logistics affecting tea exports: Colombo Port, freight rates, Red Sea/
          Suez Canal disruption, container availability
        - Currency & trade affecting tea trade: LKR exchange rate, Sri Lanka trade policy,
          tariffs on tea-exporting or tea-importing countries
        - Weather & crop conditions in Sri Lanka, Kenya, or India (competing tea origins)
        - Global economy events with a plausible link to tea trade or exporter costs

        Score relevance 0-100 (0 = no connection to any of the above, 100 = directly and
        significantly about Ceylon tea auctions). Assign exactly one category from:
        TeaMarket, ShippingLogistics, CurrencyTrade, WeatherCrop, GlobalEconomy.
        Write "whyItMatters" as 1-2 plain sentences, grounded strictly in the item's own
        title/summary — never fabricate a number, name, or claim that isn't in them.

        Respond with ONLY a JSON array, no other text, in this exact shape:
        [{"index":0,"relevanceScore":72,"category":"ShippingLogistics","whyItMatters":"..."}]
        """;

    public async Task<List<MarketPulseScoringResult>> ScoreBatchAsync(List<MarketPulseScoringInput> items, CancellationToken ct)
    {
        if (items.Count == 0) return [];

        var payload = JsonSerializer.Serialize(items.Select(i => new { i.Index, i.Title, i.Summary }));
        var history = new List<(string Role, string Content)> { ("user", payload) };

        foreach (var providerKey in ProviderOrder)
        {
            using var attemptCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            attemptCts.CancelAfter(PerProviderTimeout);
            try
            {
                var (reply, usedProvider) = await gateway.CompleteAsync(
                    providerKey, SystemPrompt, history, tools: [], executeTool: (_, _) => Task.FromResult(""), attemptCts.Token);
                var parsed = ParseResults(reply, items.Count);
                if (parsed.Count > 0)
                {
                    logger.LogInformation("Market Pulse: scored {Count}/{Total} item(s) via {Provider}", parsed.Count, items.Count, usedProvider);
                    return parsed;
                }
                logger.LogWarning("Market Pulse: {Provider} responded but nothing parsed as valid scores — trying next provider", providerKey);
            }
            catch (ProviderUnavailableException ex)
            {
                logger.LogInformation("Market Pulse: provider {Provider} unavailable ({Message}) — trying next", providerKey, ex.Message);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Our own caller (the ingestion cycle, or app shutdown) actually wants this
                // to stop — never swallow that, unlike every other exception here.
                throw;
            }
            catch (Exception ex)
            {
                // Deliberately NOT scoped to "ex is not OperationCanceledException": a slow
                // local model (e.g. Ollama on CPU) times out as a TaskCanceledException,
                // which IS an OperationCanceledException — AiGateway's own catch guard
                // (see its doc comment) treats that the same as a caller-cancelled request
                // and lets it propagate unwrapped rather than as ProviderUnavailableException.
                // Confirmed live 24 Aug 2026: without this broader catch, a single slow
                // provider's HttpClient timeout escaped this whole method and 500'd the
                // manual /refresh endpoint instead of just moving on to the next provider.
                logger.LogWarning(ex, "Market Pulse: provider {Provider} threw unexpectedly — trying next", providerKey);
            }
        }

        logger.LogWarning("Market Pulse: every AI provider failed or is unconfigured — {Count} item(s) stay unscored this cycle", items.Count);
        return [];
    }

    private List<MarketPulseScoringResult> ParseResults(string reply, int expectedCount)
    {
        // Models occasionally wrap the array in prose or a fenced code block despite the
        // system prompt's instruction — take the outermost [...] substring rather than
        // trusting the response to be nothing but JSON.
        var start = reply.IndexOf('[');
        var end = reply.LastIndexOf(']');
        if (start < 0 || end <= start) return [];

        List<RawResult>? raw;
        try
        {
            raw = JsonSerializer.Deserialize<List<RawResult>>(
                reply[start..(end + 1)], new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Market Pulse: AI response wasn't valid JSON");
            return [];
        }
        if (raw is null) return [];

        var results = new List<MarketPulseScoringResult>();
        foreach (var r in raw)
        {
            if (r.Index < 0 || r.Index >= expectedCount) continue;
            if (!Enum.TryParse<MarketPulseCategory>(r.Category, ignoreCase: true, out var category)) continue;
            results.Add(new MarketPulseScoringResult(
                r.Index, Math.Clamp(r.RelevanceScore, 0, 100), category, r.WhyItMatters ?? ""));
        }
        return results;
    }

    private record RawResult(
        [property: JsonPropertyName("index")] int Index,
        [property: JsonPropertyName("relevanceScore")] int RelevanceScore,
        [property: JsonPropertyName("category")] string Category,
        [property: JsonPropertyName("whyItMatters")] string? WhyItMatters);
}
