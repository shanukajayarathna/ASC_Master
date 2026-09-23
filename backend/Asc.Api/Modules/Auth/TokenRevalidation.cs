using System.Security.Claims;
using Asc.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.Memory;
using MongoDB.Driver;

namespace Asc.Api.Modules.Auth;

/// <summary>
/// A JWT is valid for 12 hours and carries its roles as claims, so on its own it keeps working
/// after the account is deleted or demoted. This re-checks every validated token against the
/// user record (briefly cached — one Mongo read per user per <see cref="CacheTtl"/>, not per
/// request): a deleted user is rejected, and the roles in the database replace the roles the
/// token was minted with. AuthController evicts the cache entry on role/credential changes and
/// deletion so those take effect immediately rather than after the TTL.
/// </summary>
public static class TokenRevalidation
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

    public static string CacheKey(Guid userId) => $"auth:user:{userId:N}";

    public static void Evict(IMemoryCache cache, Guid userId) => cache.Remove(CacheKey(userId));

    public static async Task OnTokenValidated(TokenValidatedContext ctx)
    {
        var identity = ctx.Principal?.Identities.FirstOrDefault();
        if (identity is null || !Guid.TryParse(identity.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
        {
            ctx.Fail("Token has no valid subject.");
            return;
        }

        var services = ctx.HttpContext.RequestServices;
        var cache = services.GetRequiredService<IMemoryCache>();
        var roles = await cache.GetOrCreateAsync(CacheKey(userId), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheTtl;
            var db = services.GetRequiredService<MongoContext>();
            var user = await db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync(ctx.HttpContext.RequestAborted);
            return user?.Roles.ToArray(); // null (cached too) = the account no longer exists
        });

        if (roles is null)
        {
            ctx.Fail("Account no longer exists.");
            return;
        }

        foreach (var claim in identity.FindAll(ClaimTypes.Role).ToList()) identity.RemoveClaim(claim);
        foreach (var role in roles) identity.AddClaim(new Claim(ClaimTypes.Role, role));
    }
}
