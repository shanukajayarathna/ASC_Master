using System.ServiceModel.Syndication;
using System.Xml;

namespace Asc.Api.Modules.MarketPulse;

/// <summary>One RSS/Atom entry as read straight off the wire — nothing here is AI-derived
/// or reshaped; <see cref="Summary"/> is exactly the feed's own description/summary text.</summary>
public record MarketPulseFeedItem(string Url, string Title, string Summary, DateTime? PublishedAt);

public interface IMarketPulseFeedFetcher
{
    Task<List<MarketPulseFeedItem>> FetchAsync(string feedUrl, CancellationToken ct);
}

/// <summary>Thin wrapper over the standard library's own RSS/Atom reader
/// (<see cref="SyndicationFeed"/>) — same typed-<see cref="HttpClient"/> shape as
/// <c>WebhookSender</c>, registered the same way in Program.cs. One malformed or
/// unreachable feed must never take down the ingestion cycle for every other source, so
/// this throws on failure and lets the caller (<see cref="MarketPulseIngestionEngine"/>)
/// catch per-source, exactly like <c>MslImportService</c> isolates one bad file from the
/// rest of a scan.</summary>
public class MarketPulseFeedFetcher(HttpClient http) : IMarketPulseFeedFetcher
{
    public async Task<List<MarketPulseFeedItem>> FetchAsync(string feedUrl, CancellationToken ct)
    {
        await using var stream = await http.GetStreamAsync(feedUrl, ct);
        using var xmlReader = XmlReader.Create(stream, new XmlReaderSettings { Async = true, DtdProcessing = DtdProcessing.Ignore });
        var feed = SyndicationFeed.Load(xmlReader) ?? throw new InvalidOperationException("Feed did not parse to a valid RSS/Atom document.");

        var items = new List<MarketPulseFeedItem>();
        foreach (var entry in feed.Items)
        {
            var link = entry.Links.FirstOrDefault(l => l.RelationshipType is null or "alternate")?.Uri.ToString()
                ?? entry.Links.FirstOrDefault()?.Uri.ToString();
            if (string.IsNullOrWhiteSpace(link)) continue; // an item with no real URL can't be linked back to — skip it, don't fabricate one

            var summary = entry.Summary?.Text ?? entry.Content switch
            {
                TextSyndicationContent text => text.Text,
                _ => string.Empty,
            };

            items.Add(new MarketPulseFeedItem(
                link,
                entry.Title?.Text ?? "(untitled)",
                summary.Trim(),
                entry.PublishDate.UtcDateTime == default ? null : entry.PublishDate.UtcDateTime));
        }
        return items;
    }
}
