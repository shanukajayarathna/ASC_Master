using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Asc.Api.Data;
using Asc.Api.Modules.ApiKeys;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.Documents;
using Asc.Api.Modules.Reports;
using Asc.Api.Modules.Webhooks;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;

// SaleFileStore parses each sale's Excel file synchronously (ClosedXML has no async API),
// directly on whatever thread calls it — and SaleMetaWarmer does the same, sequentially,
// on a background thread pool worker for as long as it takes to warm every sale on disk.
// The dashboard alone can fan out into 6-8 of these calls in parallel (active sale, the
// recent-sales comparison window, analytics). The CLR's thread pool starts at
// Environment.ProcessorCount and only grows ~1 thread/~500ms under sustained demand, so a
// burst like that can starve genuinely fast, already-async endpoints (e.g. auth/me) behind
// it for several seconds while they wait for a free worker thread. Raising the floor here
// means a burst doesn't have to wait on that slow growth. This doesn't make the parsing
// itself faster — it just stops it from blocking unrelated requests.
ThreadPool.SetMinThreads(Math.Max(Environment.ProcessorCount * 4, 16), Math.Max(Environment.ProcessorCount * 4, 16));

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

// AI Assistant — three chat vendors behind the same IChatProvider seam (Modules/Assistant/AiGateway.cs):
// OpenAI and Groq are OpenAI-wire-format (share OpenAiCompatibleChatProvider), Gemini has its own
// wire format. Every tool any of them can call is read-only (Modules/Assistant/AssistantTools.cs).
// Gemini/Groq are optional — GetRequiredService below still resolves fine unconfigured, since
// "configured" is a runtime check (IsConfigured), not a DI-time one; OpenAI keeps working
// regardless of whether the other two ever get keys.
builder.Services.AddHttpClient<OpenAiChatProvider>();
builder.Services.AddHttpClient<GroqChatProvider>();
builder.Services.AddHttpClient<GeminiChatProvider>();
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<OpenAiChatProvider>());
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<GroqChatProvider>());
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<GeminiChatProvider>());
builder.Services.AddScoped<AiGateway>();
builder.Services.AddSingleton<AssistantToolExecutor>();

// Reporting — no PDF library here on purpose; the frontend renders the report and the
// browser's own Print → Save as PDF covers that leg (see Modules/Reports/ReportsController.cs).
builder.Services.AddSingleton<ReportGenerator>();

// Combined Report / Top Prices — cross-broker per-grade ranking (see Modules/AuctionReports).
builder.Services.AddSingleton<Asc.Api.Modules.AuctionReports.TopPriceEngine>();
builder.Services.AddSingleton<Asc.Api.Modules.AuctionReports.AuctionReportExcelBuilder>();

// Worksheet — rough pre-auction scratchpad, never persisted (see Modules/Worksheet).
builder.Services.AddSingleton<Asc.Api.Modules.Worksheet.WorksheetExcelBuilder>();

// Outbound event notifications (e.g. "catalogue.imported") for external tools like n8n —
// a short timeout since this fires inline inside user-facing requests and must never hang
// one on a dead/slow external endpoint (see WebhookSender's own doc comment).
builder.Services.AddHttpClient<IWebhookSender, WebhookSender>(client => client.Timeout = TimeSpan.FromSeconds(5));

const string ApiKeyScheme = "ApiKey";
const string SmartScheme = "Smart";

builder.Services
    .AddAuthentication(opts =>
    {
        // A policy scheme that inspects the request and forwards to whichever real scheme
        // applies — JWT bearer for a normal browser session, the API key scheme for an
        // external caller. Every existing [Authorize]/[Authorize(Roles=...)] attribute in
        // this codebase keeps resolving to the implicit default with zero changes; this is
        // what that default now points at.
        opts.DefaultAuthenticateScheme = SmartScheme;
        opts.DefaultChallengeScheme = SmartScheme;
    })
    .AddPolicyScheme(SmartScheme, "JWT or API Key", opts =>
    {
        opts.ForwardDefaultSelector = ctx =>
            ctx.Request.Headers.ContainsKey("X-Api-Key") ? ApiKeyScheme : JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, opts =>
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
    })
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(ApiKeyScheme, _ => { });
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
