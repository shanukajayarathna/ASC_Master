namespace Asc.Api.Modules.AccessRequests;

public record SubmitAccessRequestDto(string Name, string Email, string Company, string Message);

public record AccessRequestDto(Guid Id, string Name, string Email, string Company, string Message, string Status, DateTime CreatedAt);
