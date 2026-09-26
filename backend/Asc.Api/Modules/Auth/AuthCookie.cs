using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Asc.Api.Modules.Auth;

/// <summary>
/// The browser session: the signed JWT lives in an HttpOnly cookie, so page scripts (and therefore any injected script)
/// can never read it, unlike the old localStorage copy. Scripts and other tools may still send the same token as a
/// Bearer header, and API keys are untouched.
/// </summary>
public static class AuthCookie
{
    public const string Name = "asc_session";
    /// <summary>Header the browser app adds to every request. A cross-site page cannot send a custom header without a CORS
    /// preflight the API refuses, so requiring it on cookie-authenticated writes closes cross-site request forgery.</summary>
    public const string CsrfHeader = "X-Requested-With";
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);

    private static CookieOptions Options(HttpContext ctx, DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = ctx.Request.IsHttps,   // behind the TLS proxy this is true (forwarded proto); plain http only on localhost dev
        SameSite = SameSiteMode.Lax,
        Path = "/",
        Expires = expires,
        IsEssential = true,
    };

    public static void Set(HttpContext ctx, string token) =>
        ctx.Response.Cookies.Append(Name, token, Options(ctx, DateTimeOffset.UtcNow.Add(Lifetime)));

    public static void Clear(HttpContext ctx) => ctx.Response.Cookies.Delete(Name, Options(ctx, null));

    /// <summary>JwtBearer reads the Authorization header first; with none, take the session cookie.</summary>
    public static Task ReadFromCookie(MessageReceivedContext ctx)
    {
        if (string.IsNullOrEmpty(ctx.Token) && ctx.Request.Cookies.TryGetValue(Name, out var token) && !string.IsNullOrEmpty(token))
            ctx.Token = token;
        return Task.CompletedTask;
    }

    /// <summary>True for a state-changing request that rides on the session cookie alone (no Bearer header, no API key)
    /// and lacks the app's custom header — such a request could have been forged by another site.</summary>
    public static bool IsForgeable(HttpRequest r) =>
        !HttpMethods.IsGet(r.Method) && !HttpMethods.IsHead(r.Method) && !HttpMethods.IsOptions(r.Method)
        && r.Cookies.ContainsKey(Name)
        && !r.Headers.ContainsKey("Authorization") && !r.Headers.ContainsKey("X-Api-Key")
        && !r.Headers.ContainsKey(CsrfHeader);
}
