using System.Security.Claims;
using System.Text.Encodings.Web;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace Asc.Api.Modules.ApiKeys;

/// <summary>
/// Validates the X-Api-Key header against stored key hashes and, on success, builds a
/// ClaimsPrincipal shaped exactly like AuthController.IssueToken's JWT claims (NameIdentifier/
/// Name/one Role claim per role) — so every existing [Authorize(Roles=...)] check works
/// identically for a key as for a user's token, with zero changes to any controller.
/// Registered under Program.cs's "Smart" policy scheme, which forwards here only when the
/// X-Api-Key header is present; JWT bearer requests never reach this handler at all.
/// </summary>
public class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    MongoContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Api-Key", out var raw) || string.IsNullOrWhiteSpace(raw))
            return AuthenticateResult.NoResult();

        var hash = ApiKeyHasher.Hash(raw.ToString());
        var key = await db.ApiKeys.Find(k => k.KeyHash == hash).FirstOrDefaultAsync();
        if (key is null) return AuthenticateResult.Fail("Invalid API key.");

        List<Claim> claims =
        [
            new(ClaimTypes.NameIdentifier, key.Id.ToString()),
            new(ClaimTypes.Name, key.Name),
            .. key.Roles.Select(r => new Claim(ClaimTypes.Role, r)),
        ];
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));

        try
        {
            await db.ApiKeys.UpdateOneAsync(k => k.Id == key.Id, Builders<ApiKey>.Update.Set(k => k.LastUsedAt, DateTime.UtcNow));
        }
        catch
        {
            // Best-effort only — a write hiccup here must never turn into an auth failure.
        }

        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }
}
