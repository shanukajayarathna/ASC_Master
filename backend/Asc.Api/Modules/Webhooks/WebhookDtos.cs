namespace Asc.Api.Modules.Webhooks;

public record CreateWebhookRequestDto(string Url, string Event);

public record WebhookSummaryDto(Guid Id, string Url, string Event, DateTime CreatedAt);

/// <summary>Returned only once, at creation — Secret is never retrievable again afterward.</summary>
public record WebhookCreatedDto(WebhookSummaryDto Summary, string Secret);
