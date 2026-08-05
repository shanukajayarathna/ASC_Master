namespace Asc.Api.Modules.ApiKeys;

public record CreateApiKeyRequestDto(string Name, List<string> Roles);

public record ApiKeySummaryDto(Guid Id, string Name, string KeyPrefix, List<string> Roles, DateTime CreatedAt, DateTime? LastUsedAt);

/// <summary>Returned only once, at creation — RawKey is never retrievable again afterward.</summary>
public record ApiKeyCreatedDto(ApiKeySummaryDto Summary, string RawKey);
