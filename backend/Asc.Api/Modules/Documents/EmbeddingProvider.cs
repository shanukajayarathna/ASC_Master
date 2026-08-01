using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Asc.Api.Modules.Documents;

/// <summary>
/// The embeddings seam — same swap-later shape as <see cref="IDocumentStore"/>: OpenAI today,
/// a different provider is a one-class swap later (Claude/Anthropic has no embeddings API,
/// which is why this is a separate vendor from whatever the AI Assistant phase uses for chat).
/// </summary>
public interface IEmbeddingProvider
{
    /// <summary>Batched, not one call per text — OpenAI's endpoint accepts an array of inputs
    /// and returns one vector per input in the same order.</summary>
    Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken ct = default);
}

public class OpenAiEmbeddingProvider(HttpClient http, IConfiguration config) : IEmbeddingProvider
{
    private record EmbeddingRequest([property: JsonPropertyName("model")] string Model, [property: JsonPropertyName("input")] IReadOnlyList<string> Input);
    private record EmbeddingItem([property: JsonPropertyName("embedding")] float[] Embedding, [property: JsonPropertyName("index")] int Index);
    private record EmbeddingResponse([property: JsonPropertyName("data")] List<EmbeddingItem> Data);

    public async Task<float[][]> EmbedAsync(IReadOnlyList<string> texts, CancellationToken ct = default)
    {
        if (texts.Count == 0) return [];

        var apiKey = config["OpenAI:ApiKey"]
            ?? throw new InvalidOperationException(
                "OpenAI:ApiKey is not configured. Set it with: dotnet user-secrets set OpenAI:ApiKey \"sk-...\"");
        var model = config["OpenAI:Model"] ?? "text-embedding-3-small";

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/embeddings")
        {
            Content = JsonContent.Create(new EmbeddingRequest(model, texts)),
        };
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"OpenAI embeddings request failed ({(int)res.StatusCode}): {body}");
        }

        var parsed = await res.Content.ReadFromJsonAsync<EmbeddingResponse>(ct)
            ?? throw new InvalidOperationException("OpenAI embeddings response was empty.");
        return parsed.Data.OrderBy(d => d.Index).Select(d => d.Embedding).ToArray();
    }
}
