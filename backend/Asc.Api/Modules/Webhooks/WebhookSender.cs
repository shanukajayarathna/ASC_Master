using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Asc.Api.Data;
using MongoDB.Driver;

namespace Asc.Api.Modules.Webhooks;

public interface IWebhookSender
{
    Task SendAsync(string eventName, object payload, CancellationToken ct = default);
}

/// <summary>
/// Fire-and-verify, never fire-and-throw: this runs inline inside user-facing requests (e.g.
/// CataloguesController.Import), so a dead or slow external endpoint must never fail or hang
/// the request it's attached to. Each subscription is POSTed independently, HMAC-SHA256-signed
/// with its own secret (X-ASC-Signature) so the receiver can verify authenticity; any failure
/// is logged and swallowed, never surfaced to the caller. The HttpClient this is registered
/// with (see Program.cs) has a short timeout for the same reason.
/// </summary>
public class WebhookSender(HttpClient http, MongoContext db, ILogger<WebhookSender> logger) : IWebhookSender
{
    public async Task SendAsync(string eventName, object payload, CancellationToken ct = default)
    {
        var subscriptions = await db.WebhookSubscriptions.Find(s => s.Event == eventName).ToListAsync(ct);
        if (subscriptions.Count == 0) return;

        var body = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        foreach (var sub in subscriptions)
        {
            try
            {
                var signature = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(sub.Secret), Encoding.UTF8.GetBytes(body)));
                using var request = new HttpRequestMessage(HttpMethod.Post, sub.Url)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("X-ASC-Event", eventName);
                request.Headers.Add("X-ASC-Signature", signature);

                using var response = await http.SendAsync(request, ct);
                if (!response.IsSuccessStatusCode)
                    logger.LogWarning("Webhook delivery to {Url} for {Event} failed with {Status}", sub.Url, eventName, response.StatusCode);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Webhook delivery to {Url} for {Event} threw", sub.Url, eventName);
            }
        }
    }
}
