using System.Text.RegularExpressions;

namespace Asc.Api.Modules.Knowledge;

public record CttaBylawsSection(string Title, string Text);

/// <summary>Key Constants first, then the section(s) matching the topic. MatchedSections is
/// empty when nothing matched, so the caller can tell "only the constants" apart from a hit.</summary>
public record CttaBylawsLookupResult(
    string? LastVerified,
    string Caveat,
    IReadOnlyList<CttaBylawsSection> Sections,
    IReadOnlyList<string> MatchedSections,
    IReadOnlyList<string> AvailableSections);

public interface ICttaBylawsService
{
    /// <summary>Null when the reference file isn't present on this server.</summary>
    CttaBylawsLookupResult? Lookup(string? topic);
}

/// <summary>
/// Serves the CTTA By-Laws reference (docs/ctta-bylaws-knowledge-base.md — the one canonical
/// copy) to the AI agents by section, keyed off the file's own "## " headings. Deliberately not
/// embeddings: the vector knowledge base needs an OpenAI key for every query, and fixed-size
/// chunks can split a table row from its label — this returns whole sections, so figures are
/// quoted exactly and work with every chat provider. Editing the file is the whole update path:
/// it is re-read whenever its last-write time changes. The same file is still picked up by
/// PlatformDocsSyncService, so vector search covers it too once embeddings are configured.
/// </summary>
public class CttaBylawsService(IWebHostEnvironment env, ILogger<CttaBylawsService> logger) : ICttaBylawsService
{
    public const string FileName = "ctta-bylaws-knowledge-base.md";
    internal const string KeyConstantsTitle = "Key Constants (quick reference)";

    /// <summary>Framing only, no business number beyond the reference's own Section 15
    /// (suspension valid for up to 3 months).</summary>
    public const string Caveat =
        "The Ceylon Chamber of Commerce may amend or suspend any By-Law or Condition of Sale (a suspension " +
        "is valid for up to 3 months and can be extended), and this reference does not auto-reflect that — " +
        "verify against current CCC/CTTA notices before relying on it.";

    private static readonly TimeSpan RegexTimeout = TimeSpan.FromSeconds(1);
    private static readonly Regex SectionNumber = new(@"^\d+\.\s*", RegexOptions.Compiled, RegexTimeout);
    private static readonly Regex LastVerifiedLine = new(@"^\*\*Last verified:\*\*\s*(?<date>\d{4}-\d{2}-\d{2})", RegexOptions.Compiled | RegexOptions.ExplicitCapture, RegexTimeout);
    private static readonly Regex Word = new("[a-z0-9]+", RegexOptions.Compiled, RegexTimeout);

    private static readonly HashSet<string> StopWords =
    [
        "the", "and", "for", "what", "whats", "how", "when", "who", "why", "which", "does", "can", "are",
        "with", "after", "before", "long", "much", "many", "have", "has", "this", "that", "from", "into",
        "get", "will", "would", "should", "there", "their", "about", "under", "per", "any", "all", "its",
        "our", "you", "your", "happen", "happens", "time", "tell", "rule", "rules", "bylaw", "bylaws", "law", "laws",
    ];

    internal sealed record ParsedDoc(string? LastVerified, List<CttaBylawsSection> Sections);

    private readonly Lock _gate = new();
    private (string Path, DateTime Stamp, ParsedDoc Doc)? _cache;

    public CttaBylawsLookupResult? Lookup(string? topic)
    {
        var doc = Load();
        return doc is null ? null : BuildResult(doc, topic);
    }

    private ParsedDoc? Load()
    {
        // TODO(remote-api-migration): replace local docs/ file read with remote API client once backend migration lands.
        // Repo layout first (backend/Asc.Api → ../../docs, same walk PlatformDocsSyncService uses),
        // then the copy Asc.Api.csproj places next to the binaries.
        string[] candidates =
        [
            Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "..", "docs", FileName)),
            Path.Combine(AppContext.BaseDirectory, "docs", FileName),
        ];
        var path = candidates.FirstOrDefault(File.Exists);
        if (path is null)
        {
            logger.LogWarning("CTTA By-Laws reference not found; looked in {Paths}", string.Join(", ", candidates));
            return null;
        }

        var stamp = File.GetLastWriteTimeUtc(path);
        lock (_gate)
        {
            if (_cache is { } c && string.Equals(c.Path, path, StringComparison.Ordinal) && c.Stamp == stamp) return c.Doc;
            var doc = Parse(File.ReadAllText(path));
            _cache = (path, stamp, doc);
            return doc;
        }
    }

    /// <summary>Splits at "## " headings ("### " stays inside its section). A section ends at its
    /// first "---" rule, which drops the file's closing footnote — the caveat travels separately.</summary>
    internal static ParsedDoc Parse(string markdown)
    {
        string? lastVerified = null;
        var sections = new List<CttaBylawsSection>();
        string? title = null;
        var body = new List<string>();

        void Flush()
        {
            if (title is null) return;
            var cut = body.FindIndex(l => string.Equals(l.Trim(), "---", StringComparison.Ordinal));
            sections.Add(new CttaBylawsSection(title, string.Join('\n', cut >= 0 ? body.Take(cut) : body).Trim()));
            body.Clear();
        }

        foreach (var line in markdown.Replace("\r\n", "\n").Split('\n'))
        {
            if (line.StartsWith("## ", StringComparison.Ordinal))
            {
                Flush();
                title = SectionNumber.Replace(line[3..].Trim(), "");
            }
            else if (title is null)
            {
                var m = LastVerifiedLine.Match(line);
                if (m.Success) lastVerified = m.Groups["date"].Value;
            }
            else
            {
                body.Add(line);
            }
        }
        Flush();

        return new ParsedDoc(lastVerified, sections);
    }

    internal static CttaBylawsLookupResult BuildResult(ParsedDoc doc, string? topic)
    {
        var matched = Match(doc.Sections, topic);
        var sections = doc.Sections.Where(s => string.Equals(s.Title, KeyConstantsTitle, StringComparison.Ordinal)).Concat(matched).ToList();
        return new CttaBylawsLookupResult(
            doc.LastVerified, Caveat, sections,
            [.. matched.Select(s => s.Title)],
            [.. doc.Sections.Select(s => s.Title)]);
    }

    /// <summary>Keyword ranking: each distinct topic word scores 3 when it appears in a section's
    /// title, 1 when only in its body. Returns the best section, plus the runner-up when it scores
    /// at least half as well. Key Constants is excluded — BuildResult always includes it.</summary>
    internal static List<CttaBylawsSection> Match(IReadOnlyList<CttaBylawsSection> sections, string? topic)
    {
        var query = Stems(topic ?? "");
        if (query.Count == 0) return [];

        var ranked = sections
            .Select((s, i) => (Section: s, Index: i))
            .Where(x => !string.Equals(x.Section.Title, KeyConstantsTitle, StringComparison.Ordinal))
            .Select(x =>
            {
                var title = Stems(x.Section.Title);
                var body = Stems(x.Section.Text);
                var score = query.Sum(q => title.Contains(q) ? 3 : body.Contains(q) ? 1 : 0);
                return (x.Section, x.Index, Score: score);
            })
            .Where(x => x.Score > 0)
            .OrderByDescending(x => x.Score)
            .ThenBy(x => x.Index)
            .ToList();

        if (ranked.Count == 0) return [];
        var best = ranked[0].Score;
        return [.. ranked.Take(2).Where(x => x.Score * 2 >= best).Select(x => x.Section)];
    }

    /// <summary>Crude but deterministic stemming: drop a plural "s", keep the first 6 letters —
    /// enough for deposit/deposits, charge/charged, complaint/complaints, default/defaults.</summary>
    internal static HashSet<string> Stems(string text) =>
        Word.Matches(text.ToLowerInvariant())
            .Select(m => m.Value)
            .Where(w => w.Length >= 3 && !StopWords.Contains(w))
            .Select(w =>
            {
                if (w.Length > 3 && w.EndsWith('s') && !w.EndsWith("ss", StringComparison.Ordinal)) w = w[..^1];
                return w.Length > 6 ? w[..6] : w;
            })
            .ToHashSet(StringComparer.Ordinal);
}
