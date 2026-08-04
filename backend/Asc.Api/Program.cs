using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Asc.Api.Data;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Documents;
using Asc.Api.Modules.Reports;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "ASC Tea Auction API", Version = "v1" });
});

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<MongoContext>();
builder.Services.AddSingleton<CatalogueImportService>();
// Catalogue data is served straight from the weekly-sale Excel files (data/sales) via
// this seam — swap the implementation to move catalogues into a database (e.g. Azure).
builder.Services.AddSingleton<SaleFileStore>();
builder.Services.AddSingleton<ICatalogueSource>(sp => sp.GetRequiredService<SaleFileStore>());
// Per-lot photos and voice notes — disk-backed for now (data/media) behind a seam that a
// database/blob store can take over later without touching the media controller.
builder.Services.AddSingleton<ILotMediaStore, LocalLotMediaStore>();
// Warm every sale's row count/headers at startup so no sale lists as "0 lots" just
// because it hasn't been opened since the meta cache was last written.
builder.Services.AddHostedService<SaleMetaWarmer>();

builder.Services.AddSingleton<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();

// Uploaded documents for the knowledge base — disk-backed for now (data/documents) behind
// the same kind of swappable seam as lot media, above.
builder.Services.AddSingleton<IDocumentStore, LocalDocumentStore>();
// Embeddings go through OpenAI — a plain HttpClient, not the OpenAI SDK, since this is a
// single endpoint.
builder.Services.AddHttpClient<IEmbeddingProvider, OpenAiEmbeddingProvider>();
builder.Services.AddSingleton<IDocumentSearchService, DocumentSearchService>();

// AI Assistant — chat also goes through OpenAI (the project's choice), same plain-HttpClient
// pattern as embeddings above. Every tool it can call is read-only (Modules/Assistant/AssistantTools.cs).
builder.Services.AddHttpClient<IChatProvider, OpenAiChatProvider>();
builder.Services.AddSingleton<AssistantToolExecutor>();

// Reporting — no PDF library here on purpose; the frontend renders the report and the
// browser's own Print → Save as PDF covers that leg (see Modules/Reports/ReportsController.cs).
builder.Services.AddSingleton<ReportGenerator>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        // Explicit, not relying on the framework default (which has changed across .NET
        // versions): take claim types straight from the token with no short-name remapping,
        // and pin exactly which claim IsInRole()/[Authorize(Roles=...)] reads — this is what
        // AuthController.IssueToken issues (ClaimTypes.Role/ClaimTypes.NameIdentifier), so
        // role-gated endpoints resolve deterministically regardless of library defaults.
        opts.MapInboundClaims = false;

        var jwtKey = builder.Configuration["Jwt:Key"];
        opts.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateIssuerSigningKey = true,
            // Empty in an environment with no Jwt:Key set (e.g. a fresh dev checkout before
            // `dotnet user-secrets set Jwt:Key ...`) — startup still succeeds; every token
            // just fails validation until the key is configured, rather than crashing here.
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey ?? Guid.NewGuid().ToString())),
            ValidateLifetime = true,
            RoleClaimType = ClaimTypes.Role,
            NameClaimType = ClaimTypes.NameIdentifier,
        };
    });
builder.Services.AddAuthorization();

// Throttles login attempts per client IP so a stolen/guessed-at password list can't be
// brute-forced against /api/v1/auth/login — there's no account lockout, so this is the
// only thing standing between an attacker and unlimited guesses.
const string LoginRateLimitPolicy = "login";
builder.Services.AddRateLimiter(opts =>
{
    opts.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    opts.AddPolicy(LoginRateLimitPolicy, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

const string CorsPolicy = "FrontendDev";
builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

if (string.IsNullOrEmpty(builder.Configuration["Jwt:Key"]))
{
    app.Logger.LogWarning(
        "Jwt:Key is not configured — the app will start, but every issued/validated token will use a " +
        "random per-process key, so all tokens fail validation. Set it with: " +
        "dotnet user-secrets set Jwt:Key \"<random-string>\"");
}
else if (builder.Configuration["Jwt:Key"]!.Length < 32)
{
    app.Logger.LogWarning(
        "Jwt:Key is shorter than 32 characters — HMAC-SHA256 tokens signed with a short key are " +
        "easier to brute-force offline. Use a longer random value.");
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors(CorsPolicy);
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
