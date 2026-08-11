namespace Asc.Api.Modules.Knowledge;

public class KnowledgeService(IEnumerable<IKnowledgeSource> sources) : IKnowledgeService
{
    // Mirrors the existing per-source cap (DocumentSearchService already returns its own top
    // 8) — this is the "don't dump everything on the model" cap once multiple sources exist.
    private const int MaxResults = 10;

    public async Task<List<KnowledgeResultDto>> SearchKnowledgeAsync(string query, CancellationToken ct = default)
    {
        var perSource = await Task.WhenAll(sources.Select(s => s.SearchAsync(query, ct)));
        return [.. perSource.SelectMany(r => r).OrderByDescending(r => r.Score).Take(MaxResults)];
    }
}
