using System.Net.Mail;
using Asc.Api.Data;
using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MongoDB.Driver;

namespace Asc.Api.Modules.AccessRequests;

/// <summary>
/// "Request Access" — the public landing page's front door for prospects, since this app has
/// no self-service signup (see AuthController.Register). Submissions queue here for an Admin
/// to review and, if approved, provision a real account through the existing Users admin flow.
/// </summary>
[ApiController]
[Route("api/v1/access-requests")]
public class AccessRequestsController(MongoContext db) : ControllerBase
{
    [HttpPost]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<AccessRequestDto>> Submit(SubmitAccessRequestDto dto, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.Name) || string.IsNullOrWhiteSpace(dto.Email) || string.IsNullOrWhiteSpace(dto.Company))
            return BadRequest("Name, email, and company are required.");
        if (dto.Name.Length > 200 || dto.Company.Length > 200 || (dto.Message?.Length ?? 0) > 2000)
            return BadRequest("One or more fields exceed the maximum allowed length.");
        if (!MailAddress.TryCreate(dto.Email.Trim(), out _))
            return BadRequest("Email is not a valid email address.");

        var request = new AccessRequest
        {
            Name = dto.Name.Trim(),
            Email = dto.Email.Trim().ToLowerInvariant(),
            Company = dto.Company.Trim(),
            Message = dto.Message?.Trim() ?? string.Empty,
        };

        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        await db.AccessRequests.InsertOneAsync(request, cancellationToken: ct);
        return Ok(ToDto(request));
    }

    [HttpGet]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<ActionResult<List<AccessRequestDto>>> List(CancellationToken ct)
    {
        // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
        var requests = await db.AccessRequests.Find(FilterDefinition<AccessRequest>.Empty)
            .SortBy(r => r.Status).ThenByDescending(r => r.CreatedAt).ToListAsync(ct);
        return Ok(requests.Select(ToDto).ToList());
    }

    [HttpPatch("{id:guid}/reviewed")]
    [Authorize(Policy = Policies.ManageUsers)]
    public async Task<IActionResult> MarkReviewed(Guid id, CancellationToken ct)
    {
        var result = await db.AccessRequests.UpdateOneAsync(
            r => r.Id == id,
            Builders<AccessRequest>.Update.Set(r => r.Status, AccessRequestStatus.Reviewed),
            cancellationToken: ct);
        return result.MatchedCount == 0 ? NotFound() : NoContent();
    }

    private static AccessRequestDto ToDto(AccessRequest r) => new(r.Id, r.Name, r.Email, r.Company, r.Message, r.Status.ToString(), r.CreatedAt);
}
