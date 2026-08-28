using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using Asc.Api.Data;
using Asc.Api.Modules.Agents;
using Asc.Api.Modules.ApiKeys;
using Asc.Api.Modules.Assistant;
using Asc.Api.Modules.Audit;
using Asc.Api.Modules.Auth;
using Asc.Api.Modules.CategoryReports;
using Asc.Api.Modules.Deadlines;
using Asc.Api.Modules.Documents;
using Asc.Api.Modules.Knowledge;
using Asc.Api.Modules.LandingContent;
using Asc.Api.Modules.MarketPulse;
using Asc.Api.Modules.MasterData;
using Asc.Api.Modules.Msl;
using Asc.Api.Modules.Notifications;
using Asc.Api.Modules.Observability;
using Asc.Api.Modules.Performance;
using Asc.Api.Modules.Reports;
using Asc.Api.Modules.ScheduledReports;
using Asc.Api.Modules.Webhooks;
using Asc.Api.Modules.Workflow;
using Asc.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;

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

// Defense in depth: ASP.NET Core's default (StopHost) takes the ENTIRE API down if any
// BackgroundService (MslWatcherService, DeadlineCheckService, ...) throws an unhandled
// exception — including a transient MongoDB TaskCanceledException that has nothing to do
// with a real failure. Every BackgroundService in this app is already written to catch and
// log its own exceptions per-tick (never let a bad tick kill the loop), so this is a safety
// net for a future one that doesn't get that right — not a substitute for those catches.
builder.Services.Configure<Microsoft.Extensions.Hosting.HostOptions>(opts =>
    opts.BackgroundServiceExceptionBehavior = Microsoft.Extensions.Hosting.BackgroundServiceExceptionBehavior.Ignore);

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
// Admin-uploadable report templates + branding logo (data/templates, data/branding) — same
// swappable local-disk seam as the stores above.
builder.Services.AddSingleton<Asc.Api.Modules.AdminAssets.IAdminAssetStore, Asc.Api.Modules.AdminAssets.LocalAdminAssetStore>();
// Embeddings go through OpenAI — a plain HttpClient, not the OpenAI SDK, since this is a
// single endpoint.
builder.Services.AddHttpClient<IEmbeddingProvider, OpenAiEmbeddingProvider>();
builder.Services.AddSingleton<IDocumentSearchService, DocumentSearchService>();
// Platform-docs ingestion (docs/*.md → the same documents/documentChunks pipeline) —
// triggered from the Knowledge page, not at startup: embedding costs money and needs the
// OpenAI key, so it stays an explicit admin action.
builder.Services.AddSingleton<PlatformDocsSyncService>();

// Knowledge Platform — the seam agents call instead of a search service or a raw file
// directly (see Modules/Knowledge). One source today (uploaded documents); MSL/Tea Board/
// OKLO become additional IKnowledgeSource registrations here, nothing else changes.
builder.Services.AddSingleton<IKnowledgeSource, DocumentKnowledgeSource>();
builder.Services.AddSingleton<IKnowledgeService, KnowledgeService>();

// MSL archive — the historical auction/private-sale/Tea Board dataset (data/msl, see its
// README). The watcher runs the initial backfill and then auto-imports whenever files in
// the folder change, so dropping in a new week's files updates the database by itself.
// MslRollupService materializes per-sale analytics (mslSaleStats) after each import —
// the Analysis screens and the Analytics Agent read those rollups, never raw lots.
builder.Services.AddSingleton<MslRollupService>();
builder.Services.AddSingleton<MslImportService>();
builder.Services.AddHostedService<MslWatcherService>();
// Holds the Admin Panel's upload-batch review list between "stage" (extract + detect) and
// "commit" (admin confirms which files to keep) — see MslUploadStagingService's doc comment.
builder.Services.AddSingleton<MslUploadStagingService>();
// Factory → plantation-group reference, learned from the weekly sale Excel catalogues —
// powers the Analysis screen's Group filter across all MSL years.
builder.Services.AddSingleton<MslReferenceService>();
builder.Services.AddSingleton<MslEnrichmentService>();
builder.Services.AddSingleton<MslExcelExportService>();
builder.Services.AddSingleton<MslReportExportService>();
// Weekly FACT Reports' "generate from database" option — reproduces the WES master
// workbook's factory rows from already-imported auctionLots (see its own doc comment).
builder.Services.AddSingleton<MslWeeklyReportService>();

// AI Assistant — three chat vendors behind the same IChatProvider seam (Modules/Assistant/AiGateway.cs):
// OpenAI and Groq are OpenAI-wire-format (share OpenAiCompatibleChatProvider), Gemini has its own
// wire format. Every tool any of them can call is read-only (Modules/Assistant/AssistantTools.cs).
// Gemini/Groq are optional — GetRequiredService below still resolves fine unconfigured, since
// "configured" is a runtime check (IsConfigured), not a DI-time one; OpenAI keeps working
// regardless of whether the other two ever get keys.
builder.Services.AddHttpClient<OpenAiChatProvider>();
builder.Services.AddHttpClient<GroqChatProvider>();
builder.Services.AddHttpClient<GeminiChatProvider>();
// Local model (Ollama et al.) for development/testing — opt-in via Local:Model, see
// LocalChatProvider. CPU inference can take minutes per tool-calling turn, hence the
// long timeout; a hosted vendor's client keeps the default.
builder.Services.AddHttpClient<LocalChatProvider>(c => c.Timeout = TimeSpan.FromMinutes(10));
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<OpenAiChatProvider>());
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<GroqChatProvider>());
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<GeminiChatProvider>());
builder.Services.AddSingleton<IChatProvider>(sp => sp.GetRequiredService<LocalChatProvider>());
builder.Services.AddScoped<AiGateway>();
builder.Services.AddSingleton<AssistantToolExecutor>();
// AuctionAgent's tool set — a curated subset of AssistantToolExecutor's tools (delegated to,
// never re-implemented) plus one new tool (get_top_lots); see Modules/Agents/AuctionToolExecutor.cs.
builder.Services.AddSingleton<AuctionToolExecutor>();

// AI usage/cost tracking (Phase 8 — observability) — every AiGateway call, success or
// failure, is recorded here; see Modules/Observability. Cost is only estimated for models
// with a configured "AiPricing:<model>" price entry, never guessed.
builder.Services.AddSingleton<AiCostEstimator>();
builder.Services.AddSingleton<IAiUsageLogger, AiUsageLogger>();

// Agent Platform — User Request → AgentRouter → IAgentRegistry → Selected Agent →
// KnowledgeService → LLM → Agent Response (see Modules/Agents/README.md). Scoped throughout,
// matching AiGateway's own lifetime: a scoped service can never be safely captured by a
// singleton. Two agents registered today — general (GeneralAgent) and auction (AuctionAgent),
// the first business-specific one; a third is just another IAgent registration —
// AgentRegistry/AgentRouter and every caller pick it up automatically.
builder.Services.AddScoped<IAgent, GeneralAgent>();
builder.Services.AddScoped<IAgent, AuctionAgent>();
builder.Services.AddSingleton<AnalyticsToolExecutor>();
builder.Services.AddScoped<IAgent, AnalyticsAgent>();
builder.Services.AddScoped<IAgentRegistry, AgentRegistry>();
builder.Services.AddScoped<AgentRouter>();

// Master data — canonical broker/buyer/garden/grade/... names + spelling-variant aliases,
// resolved at read time by Analytics/Market/Reports/Assistant. Lot and the file-backed
// catalogue store (SaleFileStore) are never modified — see Modules/MasterData.
builder.Services.AddSingleton<MasterDataResolver>();

// Audit trail for admin-mutating actions (role changes, API key/webhook/master-data/
// knowledge-base CRUD) — see Modules/Audit. A local persisted write, not an external
// notification, so it's unrelated to WebhookSender despite the similar event-name shape.
builder.Services.AddSingleton<IAuditLogger, AuditLogger>();

// Market Pulse — curated, AI-scored industry news (see Modules/MarketPulse). The feed
// fetcher is a typed HttpClient, same shape as WebhookSender/the chat providers above,
// short timeout since a slow/dead RSS host must never stall a whole ingestion cycle.
// MarketPulseScoringService and MarketPulseIngestionEngine are scoped (not singleton)
// because they ultimately depend on the scoped AiGateway; MarketPulseIngestionService (the
// recurring BackgroundService) creates its own scope every tick to resolve them — see its
// doc comment. MarketPulseIngestionGate is the one piece that DOES need to be a singleton:
// a shared lock so the scheduled tick and a manual admin-triggered refresh can never
// double-score the same batch.
builder.Services.AddHttpClient<IMarketPulseFeedFetcher, MarketPulseFeedFetcher>(c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<MarketPulseIngestionGate>();
builder.Services.AddScoped<MarketPulseScoringService>();
builder.Services.AddScoped<MarketPulseIngestionEngine>();
builder.Services.AddHostedService<MarketPulseIngestionService>();

// Cross-sale grade/buyer trend detection — the first analytics in this app that compares
// one sale to another rather than summarizing a single one. See Modules/Performance.
builder.Services.AddSingleton<PerformanceEngine>();

// In-app notifications (no email/WhatsApp — no provider credentials exist yet) and the
// deadline engine that's their first real producer. DeadlineCheckService is the first
// *recurring* background job in this app (SaleMetaWarmer only runs once at startup).
builder.Services.AddSingleton<INotificationService, NotificationService>();
builder.Services.AddSingleton<DeadlineEngine>();
builder.Services.AddHostedService<DeadlineCheckService>();

// Automated report generation (see Modules/ScheduledReports) — an extensible pipeline, not
// one-off jobs: adding a report type later means one new IScheduledReportJob class plus one
// registration line below, no scheduler/admin-UI/report-list change. Every job here is
// singleton (none ultimately depend on a scoped service the way Market Pulse's ingestion
// pipeline depends on the scoped AiGateway), so ScheduledReportRunnerService needs no
// per-tick IServiceScopeFactory dance — see its own doc comment. The internal HttpClient
// calls this same process's Next.js frontend server to run the existing, already-verified
// TypeScript Weekly FACT generation logic headlessly (see WeeklyFactAutoReportJob's doc
// comment for why that logic isn't reimplemented in C#); its base address and the shared
// secret both come from config (WeeklyFact:FrontendBaseUrl / WeeklyFact:InternalJobSecret),
// matching the frontend's own INTERNAL_JOB_SECRET env var.
builder.Services.AddSingleton<IWeeklyFactCbacStagingStore, LocalWeeklyFactCbacStagingStore>();
builder.Services.AddSingleton<IGeneratedReportFileStore, LocalGeneratedReportFileStore>();
builder.Services.AddSingleton<ISavedReportsService, SavedReportsService>();
// A named client, not AddHttpClient<WeeklyFactAutoReportJob>() — that shorthand registers the
// job class itself as transient, fighting every other job's singleton lifetime here. The job
// takes IHttpClientFactory and asks for this client by name instead (see its own doc comment).
builder.Services.AddHttpClient(WeeklyFactAutoReportJob.HttpClientName, c =>
{
    c.BaseAddress = new Uri(builder.Configuration["WeeklyFact:FrontendBaseUrl"] ?? "http://localhost:3000");
    c.Timeout = TimeSpan.FromMinutes(3); // Excel-template assembly for 5 categories + RANK + LOW is not instant.
});
builder.Services.AddSingleton<WeeklyFactAutoReportJob>();
builder.Services.AddSingleton<IScheduledReportJob>(sp => sp.GetRequiredService<WeeklyFactAutoReportJob>());
builder.Services.AddSingleton<IScheduledReportJob, MonthlyCombinedPlaceholderJob>();
// Registered as itself too (not just IScheduledReportJob) — FactorySaleSummaryController
// injects the concrete type directly for its own on-demand "Generate for this sale" endpoint,
// the same pattern WeeklyFactAutoReportJob uses for its HttpClientName constant.
builder.Services.AddSingleton<FactorySaleSummaryReportJob>();
builder.Services.AddSingleton<IScheduledReportJob>(sp => sp.GetRequiredService<FactorySaleSummaryReportJob>());
// Registered as itself too, same reasoning as FactorySaleSummaryReportJob just above —
// CategoryReportsController injects the concrete type for its own on-demand generate endpoint.
builder.Services.AddSingleton<EstateCategoryReportJob>();
builder.Services.AddSingleton<IScheduledReportJob>(sp => sp.GetRequiredService<EstateCategoryReportJob>());
builder.Services.AddSingleton<IScheduledReportJobRegistry, ScheduledReportJobRegistry>();
builder.Services.AddSingleton<ScheduledReportRunnerService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ScheduledReportRunnerService>());

// Reporting — no PDF library here on purpose; the frontend renders the report and the
// browser's own Print → Save as PDF covers that leg (see Modules/Reports/ReportsController.cs).
builder.Services.AddSingleton<ReportGenerator>();

// Combined Report / Top Prices — cross-broker per-grade ranking (see Modules/AuctionReports).
// Excel/PDF export for this report now happens client-side (frontend/src/lib/combinedReportExport.ts),
// ported near-verbatim from the original standalone app so the output matches exactly.
builder.Services.AddSingleton<Asc.Api.Modules.AuctionReports.TopPriceEngine>();

// Worksheet — rough pre-auction scratchpad, never persisted (see Modules/Worksheet).
builder.Services.AddSingleton<Asc.Api.Modules.Worksheet.WorksheetExcelBuilder>();

// Outbound event notifications (e.g. "catalogue.imported") for external tools like n8n —
// a short timeout since this fires inline inside user-facing requests and must never hang
// one on a dead/slow external endpoint (see WebhookSender's own doc comment).
builder.Services.AddHttpClient<IWebhookSender, WebhookSender>(client => client.Timeout = TimeSpan.FromSeconds(5));

// Workflow Layer — n8n today, swappable for Temporal (or anything else) later behind
// IWorkflowService (see Modules/Workflow). N8nWorkflowProvider is just a name over the
// webhook sender above — wrapping an AddHttpClient-backed transient inside a singleton
// factory, same pattern this file already uses for IChatProvider.
builder.Services.AddSingleton<IWorkflowService>(sp => new N8nWorkflowProvider(sp.GetRequiredService<IWebhookSender>()));

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

// Named permission seams (see Modules/Auth/Policies.cs) — every one maps to
// RequireRole(Admin) today, same as the [Authorize(Roles="Admin")] literals they replace, so
// this is a zero-behavior-change naming layer, not a retrofit onto existing policies (there
// were none before this).
builder.Services.AddAuthorization(opts =>
{
    opts.AddPolicy(Policies.ManageUsers, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageApiKeys, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageWebhooks, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageMasterData, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageKnowledgeBase, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.UseAdminAiTools, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ViewAuditLog, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ViewObservability, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageDataFiles, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageMarketPulse, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageScheduledReports, p => p.RequireRole(RoleNames.Admin));
    opts.AddPolicy(Policies.ManageLandingContent, p => p.RequireRole(RoleNames.Admin));
});

// Liveness probe for container orchestration (Phase 9) — deliberately just "did the process
// start and is it still responding", not a deep dependency check: MongoDB Atlas is a managed
// external cloud service outside this container's blast radius, so a health check that fails
// on transient Atlas latency would cause an orchestrator to kill and restart a perfectly
// healthy process for a problem restarting it can't fix.
builder.Services.AddHealthChecks();

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

const string CorsPolicy = "Frontend";
// Configurable so a deployed container can point at its real frontend origin
// (Cors:AllowedOrigins, comma-separated) without a code change — falls back to the dev
// default when unset, so local `dotnet run` behavior is unchanged.
var corsOrigins = builder.Configuration["Cors:AllowedOrigins"]?
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    ?? ["http://localhost:3000"];
builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy.WithOrigins(corsOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              // Without this, ScheduledReportsController's saved-report download response
              // carries its real filename in Content-Disposition, but the browser's fetch API
              // hides that header cross-origin unless it's explicitly exposed — the Admin
              // Panel's download button would otherwise have no way to know the file's real
              // name/extension (see AutomatedReportsSection's JobRow.download).
              .WithExposedHeaders("Content-Disposition");
    });
});

// The Analysis screen's filtered payload carries large option lists (~0.5 MB JSON);
// Brotli/Gzip shrink it ~10×, which is most of the perceived latency on repeat queries.
builder.Services.AddResponseCompression(opts =>
{
    opts.EnableForHttps = true;
    opts.MimeTypes = ["application/json"];
});

var app = builder.Build();

app.UseResponseCompression();

// Master data resolution has to be synchronous (it runs inside LINQ grouping selectors), so
// the alias table is loaded into memory once here rather than queried per lookup — see
// MasterDataResolver. MasterDataController refreshes it again after every admin write.
await app.Services.GetRequiredService<MasterDataResolver>().RefreshAsync();

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
app.MapHealthChecks("/health");

// One-time seed so the public landing page is never empty before an Admin fills in real
// copy through its CMS panel — mirrors /auth/register's "bootstrap on empty collection"
// pattern, just run eagerly at startup instead of on first request. Also refreshes the seed
// in place while it's still untouched (UpdatedBy == "system-seed", i.e. no real Admin has
// edited it yet) — covers the CMS schema evolving during development without ever
// overwriting a real Admin's edits, which always carry a different UpdatedBy.
using (var seedScope = app.Services.CreateScope())
{
    var seedDb = seedScope.ServiceProvider.GetRequiredService<MongoContext>();
    // TODO(remote-api-migration): replace MongoDB repository call with remote API client once backend migration lands.
    var existing = await seedDb.LandingPageContent.Find(FilterDefinition<LandingPageContent>.Empty).FirstOrDefaultAsync();
    if (existing is null)
    {
        await seedDb.LandingPageContent.InsertOneAsync(LandingPageContentSeed.Default());
    }
    else if (existing.UpdatedBy == "system-seed")
    {
        var refreshed = LandingPageContentSeed.Default();
        refreshed.Id = existing.Id;
        await seedDb.LandingPageContent.ReplaceOneAsync(c => c.Id == existing.Id, refreshed);
    }
}

app.Run();
