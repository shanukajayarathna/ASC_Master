using Asc.Api.Modules.Auth;
using Microsoft.AspNetCore.Http;

namespace Asc.Api.Tests;

/// <summary>The browser session is an HttpOnly cookie; writes that ride on it alone must carry the app's custom header,
/// otherwise another site could forge them.</summary>
public class AuthCookieTests
{
    private static HttpRequest Req(string method, bool cookie = false, string? authorization = null, string? apiKey = null, bool csrf = false)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        if (cookie) ctx.Request.Headers.Cookie = $"{AuthCookie.Name}=abc";
        if (authorization is not null) ctx.Request.Headers.Authorization = authorization;
        if (apiKey is not null) ctx.Request.Headers["X-Api-Key"] = apiKey;
        if (csrf) ctx.Request.Headers[AuthCookie.CsrfHeader] = "ASC";
        return ctx.Request;
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public void AWriteOnTheCookieAlone_IsRefused(string method) => Assert.True(AuthCookie.IsForgeable(Req(method, cookie: true)));

    [Theory]
    [InlineData("POST")]
    [InlineData("DELETE")]
    public void AWriteCarryingTheCustomHeader_IsAllowed(string method) => Assert.False(AuthCookie.IsForgeable(Req(method, cookie: true, csrf: true)));

    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    public void ReadsAndPreflights_AreNeverRefused(string method) => Assert.False(AuthCookie.IsForgeable(Req(method, cookie: true)));

    [Fact]
    public void BearerAndApiKeyCallers_AreNotSubjectToTheCookieRule()
    {
        Assert.False(AuthCookie.IsForgeable(Req("POST", cookie: true, authorization: "Bearer x")));
        Assert.False(AuthCookie.IsForgeable(Req("POST", apiKey: "k")));
    }

    [Fact]
    public void ARequestWithNoSessionCookie_IsNotForgeable() => Assert.False(AuthCookie.IsForgeable(Req("POST")));

    [Fact]
    public async Task TheSessionCookie_IsHttpOnly_SameSiteLax_AndSecureOverHttps()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Scheme = "https";
        AuthCookie.Set(ctx, "tok");
        var header = ctx.Response.Headers.SetCookie.ToString().ToLowerInvariant();
        Assert.Contains("asc_session=tok", header);
        Assert.Contains("httponly", header);
        Assert.Contains("samesite=lax", header);
        Assert.Contains("secure", header);

        var http = new DefaultHttpContext();
        AuthCookie.Set(http, "tok");
        Assert.DoesNotContain("secure", http.Response.Headers.SetCookie.ToString().ToLowerInvariant()); // plain-http localhost dev
        await Task.CompletedTask;
    }
}
