# ASC Master Pre-Deployment Audit

Audit date: 2026-09-07

Scope: repository audit plus local-only checks. No production systems were contacted. No application code was changed.

## Executive summary

Recommendation: **NO-GO for deployment from the current evidence.** The backend unit suite passes, but release confidence is incomplete and there are confirmed quality and operational gaps.

Top blockers:

1. **High - rollback is not documented or tested.** `DEPLOYMENT.md` documents `git pull` and rebuild, but no immutable image/tag rollback, database compatibility check, or `/data` restore procedure.
2. **High - critical user journeys are unverified.** No staging URL or test credentials were supplied, and no browser E2E suite exists. Login, catalogue, valuation sharing, report download, AI Assistant, and admin gating were not exercised end to end.
3. **High - frontend lint fails.** `npm run lint` reports 5 errors in `mark-intelligence`, `category-analysis`, `request-access`, `MarketBulletinBulletin`, and `useForceLogoutOnPublicPage`.
4. **High - security and dependency verification is incomplete.** Gitleaks/trufflehog is not installed; the .NET vulnerability query could not reach NuGet; no authenticated DAST scan was run.
5. **Medium - production build reproducibility is not established.** `next build` failed in this offline environment because `next/font/google` fetches Google Fonts at build time. It also emitted dynamic filesystem tracing warnings for the LibreOffice PDF routes.

The current worktree contains uncommitted edits in:

- `frontend/src/app/(app)/dashboard/page.tsx`
- `frontend/src/components/reports/MarketBulletinBulletin.module.css`
- `frontend/src/components/reports/MarketBulletinBulletin.tsx`

Those edits were not included in the audit as approved release changes. They need their own review, lint/build check, and functional check before merge. This report itself is intentionally untracked.

## Phase 0 discovery record

| Question | Audit answer |
|---|---|
| Staging environment | No staging URL or credentials were available. Local Compose exists, but it points to Atlas and does not provide an isolated Mongo service. No stack was started because required runtime secrets were not supplied and the available Compose target is not isolated. |
| Mongo target | Atlas is the documented target for Compose and deployment (`docker-compose.yml`, `DEPLOYMENT.md`). Bare `appsettings.json` defaults to `mongodb://localhost:27017`; this is a configuration difference that must be made explicit per environment. |
| E2E framework | Playwright is installed as a frontend dependency for server-side PDF rendering. No Playwright/Cypress browser test files or test script were found. No E2E suite was scaffolded because this is an audit, not remediation. |
| DAST | Not run. There is no reachable staging URL and no ZAP/trufflehog/gitleaks executable available in the environment. |
| Rollback runbook | No documented or tested rollback procedure was found. |
| Credentials | No credentials were provided for staging, Mongo verification, OpenAI, Gemini, Groq, Ollama, or external feeds. The working `.env` has populated values, but their validity and safety were not tested or printed. |
| Timeline | No release deadline was supplied; this report uses the full-depth gate requested. |

## Part A - Functional and integration findings

### Unit and API tests

**PASS:** `dotnet test backend/Asc.Api.Tests/Asc.Api.Tests.csproj --no-restore` completed with **262 passed, 0 failed, 0 skipped**.

**PASS:** `dotnet build backend/Asc.sln --no-restore /p:RunAnalyzers=true` completed with 0 warnings and 0 errors. This is a compiler/analyzer build, not a dedicated security rule pack.

**FINDING A1 - Medium - module coverage is uneven.** Evidence is file-level test-name matching, not a substitute for line/branch coverage. The following modules had no test-file mention: AccessRequests, AdminAssets, AuctionReports, Audit, Auth, CategoryReports, FilterPresets, LandingContent, LearningContent, MarketPulse, Notifications, Workflow, and Worksheet. ScheduledReports had only one test-file mention across 16 source files. These modules need focused unit/API coverage before release, especially authentication, public access requests, scheduled reports, notifications, webhooks, and external-feed ingestion.

The known zero/low coverage areas from the request remain valid context and were not treated as newly discovered defects. The 77 `TODO(remote-api-migration)` markers were also not raised as new findings.

### Frontend tests

**FINDING A2 - High - no frontend test suite is configured.** `frontend/package.json` exposes `dev`, `build`, `start`, and `lint`, but no Jest, RTL, Vitest, Cypress, or Playwright test script. No frontend test files were found.

**FINDING A3 - High - lint gate fails.** `npm run lint` exited 1 with these errors:

- `frontend/src/app/(app)/mark-intelligence/page.tsx:482` synchronous state update inside an effect.
- `frontend/src/app/(app)/reports/category-analysis/page.tsx:68` calls `refreshOutputs` before its declaration.
- `frontend/src/app/request-access/page.tsx:43` uses an anchor for internal `/` navigation.
- `frontend/src/components/reports/MarketBulletinBulletin.tsx:598` synchronous state updates inside an effect.
- `frontend/src/hooks/useForceLogoutOnPublicPage.ts:35` synchronous state update inside an effect.

There were also three warnings, including an unused `Divider` import and an unused eslint-disable directive.

### External integrations

The code contains OpenAI, Gemini, Groq, and optional local/Ollama providers. `Program.cs` registers all four provider clients, and the Market Pulse scorer contains a provider iteration/fallback path. No provider was called because credentials and a safe test target were unavailable. MongoDB and external feeds were likewise not independently verified.

**FINDING A4 - High - fallback behavior is unverified.** There is no evidence from this audit that each provider responds or that a deliberately failed higher-priority provider advances to the next provider. This requires a staging or isolated test with spend limits and provider failure injection.

### End-to-end testing

**FINDING A5 - High - critical E2E journeys are unverified.** The following were not run: login/auth, Catalogue Manager browse and lot detail, Valuation Centre sharing, Reports hub trigger/generate/download, AI Assistant interaction, and non-admin denial of Admin Panel access.

### UAT preparation

A stakeholder checklist is included below. Technical test execution cannot substitute for business sign-off.

## Part B - Security findings

### SAST

**PASS with limitation:** the backend solution built successfully with analyzers enabled and no compiler/analyzer diagnostics.

**FINDING B1 - Medium - no dedicated security analyzer policy is configured.** No Roslyn security analyzer package, Sonar configuration, or equivalent security rule set was found. The successful build therefore does not establish coverage for injection, unsafe deserialization, or security-specific rules.

The source review found authorization attributes on the inspected legacy controllers and feature modules, including `[Authorize]` and admin policies. Public actions such as landing content, market pulse public data, and access requests are explicitly marked `[AllowAnonymous]` and should remain in the threat model.

**FINDING B2 - Medium - direct Mongo access crosses controller boundaries.** The repository convention requested for this audit is service/repository-layer-only data access, but controllers such as `CataloguesController`, `DashboardController`, `ExportController`, `LotsController`, `AnalyticsController`, `AuthController`, `DocumentsController`, `LearningContentController`, `MarketPulseController`, `MarkIntelligenceController`, and `MasterDataController` inject `MongoContext` directly. Example evidence: `backend/Asc.Api/Controllers/LotsController.cs:21` and `backend/Asc.Api/Modules/Analytics/AnalyticsController.cs:24`. This increases authorization, query-shaping, and testability risk and should be addressed as a scoped architecture change after this audit.

**FINDING B3 - Medium - edge security headers are incomplete.** `deploy/Caddyfile` sets HSTS, content-type sniffing, frame, and referrer headers, but no Content-Security-Policy or Permissions-Policy. DAST/header review was not possible, so the actual deployed header set remains unverified.

### SCA

**PASS:** `npm audit --json` reported 0 vulnerabilities across 613 installed packages in the frontend lockfile.

**UNVERIFIED:** `dotnet list backend/Asc.Api/Asc.Api.csproj package --vulnerable --include-transitive --format json` could not load `https://api.nuget.org/v3/index.json` because outbound access was refused. No conclusion about .NET package advisories is made.

### DAST

**FINDING B4 - High - authenticated DAST was not run.** No staging URL was available, and OWASP ZAP or equivalent was not available. Injection, authorization bypass, cookie/header behavior, and input-handling risks remain unverified.

### Secret scanning

**FINDING B5 - High - full-history secret scan was not run.** `gitleaks` and `trufflehog` were not installed. The repository tracks `.env.example`, not `.env` or `frontend/.env.local`, and a limited working-tree heuristic did not find obvious committed API-key/JWT patterns. That is not equivalent to a full git-history scan. The populated local `.env` must be checked outside this report and rotated if any values are real and have been shared or committed in the past.

## Part C - Infrastructure and deployment findings

### Data migration tests

**FINDING C1 - High - no isolated Mongo migration path exists.** No migration directory, migration runner, or versioned schema script was found. `MongoContext` creates indexes at application startup (`backend/Asc.Api/Data/MongoContext.cs`), which is not an isolated, versioned, idempotence-tested deployment migration. No throwaway Mongo instance was run.

**PASS with limitation:** `SaleFileStoreTests` covers frozen legacy 2026 IDs, year-foldered IDs, flat and `2026`-foldered discovery, non-collision, and repeatable deterministic IDs. The tests are synthetic fixtures; a production-data re-run against the full `/data/sales` corpus was not performed. Legacy `catalogues` and `lots` collections remain addressable for purge, and no purge was executed.

### Rollback testing

**FINDING C2 - High - rollback is a release blocker.** `DEPLOYMENT.md` describes rebuilding after `git pull`, but not selecting a previous immutable image/tag, restoring the matching frontend/backend pair, backing up/restoring `/data`, or verifying that new Mongo writes remain readable by the previous release. No rollback was tested.

### Smoke testing

**UNVERIFIED:** no staging or isolated running stack was available. The required checks are listed below for the deployment operator.

### Build and deployment observations

**FINDING C3 - Medium - frontend build depends on live Google Fonts.** `frontend/src/app/layout.tsx:2` imports `next/font/google`; `next build` failed in this offline environment while fetching Fraunces and IBM Plex fonts. A release build in a restricted CI/network environment will fail unless fonts are made available through a controlled build path.

**FINDING C4 - Medium - PDF routes trigger broad filesystem tracing.** Next build warned at `frontend/src/app/api/reports/xlsx-to-pdf/route.ts:61` and `frontend/src/app/api/weekly-fact/pdf/route.ts:61` that dynamic `spawn(sofficePath(), ...)` filesystem access causes the whole project to be traced and included. The deployment artifact size and runtime behavior need explicit verification.

Compose validation passed and reported services `backend` and `frontend`. The production override adds Caddy, but actual TLS issuance, routing, firewall exposure, and certificate persistence were not tested.

## UAT checklist

Stakeholders should perform each scenario with representative business data and record Pass/Fail plus evidence.

1. Sign in with a valid staff account and confirm the dashboard opens with the expected current sale.
2. Try an invalid password repeatedly and confirm the account remains protected and excessive attempts are throttled.
3. Browse the Catalogue Manager, select a sale, open a lot, and confirm broker, grade, garden, quantity, and valuation details match the source catalogue.
4. Import a catalogue file as an administrator and confirm the expected sale and lot count appears without duplicating an existing sale.
5. Enter a valuation, classification, comment, and actual price for a lot, refresh the page, and confirm the saved values remain correct.
6. Have two users edit the same valuation and confirm the second user is warned rather than silently overwriting the first user's update.
7. Use the Valuation Centre sharing flow to share a selected view and confirm the recipient sees exactly the intended sale and filters.
8. Open the dashboard and Analysis views and confirm totals, broker breakdowns, quality breakdowns, and top/bottom lots reconcile to the catalogue.
9. Generate a Summary, Worksheet, Asking Price, Combined, or Market Bulletin report and confirm the displayed figures match the selected sale.
10. Download a generated report and open it in the expected spreadsheet/PDF viewer; confirm the file is complete and named correctly.
11. Ask the AI Assistant a question about the current sale and confirm the answer is grounded in the displayed catalogue data.
12. Repeat an AI Assistant question with the preferred provider unavailable and confirm the next configured provider answers without losing the conversation.
13. Upload a knowledge document as an administrator, search for a known fact, and confirm the result comes from the uploaded document.
14. Review Market Pulse items and confirm source links, dates, relevance, and stale/failed feed behavior are understandable to users.
15. Review Mark Intelligence, master data, deadlines, notifications, audit log, observability, and performance screens using business examples and confirm each output is plausible.
16. Create, edit, disable, and re-enable a webhook or API key as an administrator and confirm a non-administrator cannot perform those actions.
17. Create a scheduled report, wait for or trigger its run, download the result, and confirm duplicate runs do not create duplicate business reports.
18. Sign in as a non-administrator and confirm Admin Panel pages and admin actions are denied, while ordinary catalogue and report workflows remain available.
19. Submit a public access request, approve it as an administrator, and confirm the resulting account can sign in with the intended role.
20. Confirm all exported figures, currency labels, dates, grades, broker names, and lot identifiers match the organization's agreed business terminology.

## Post-deploy smoke checklist

1. Open the public HTTPS URL and confirm Caddy serves the frontend.
2. Confirm `/health` responds through Caddy and does not expose secrets or unnecessary diagnostics.
3. Sign in with a smoke-test account.
4. Read one catalogue and lot from Mongo-backed valuation state and one catalogue/lot from `/data/sales`.
5. Confirm at least one configured AI provider responds, then record provider name and timestamp.
6. Open one report, generate it, and download it.
7. Confirm Caddy terminates TLS, routes `/api/*` to the backend, and preserves required security headers.
8. Confirm application logs show no startup index, file-store, authentication, or provider errors.

## Checks not run or not fully verified

- No staging URL, staging credentials, or release-like test data were supplied.
- No production systems were contacted.
- No local Compose stack was started because Compose uses Atlas rather than an isolated Mongo service and required runtime secrets were not provided.
- OpenAI, Gemini, Groq, and Ollama response checks were not run.
- AI fallback failure injection was not run.
- MongoDB connectivity and index behavior against a live target were not run.
- Market Pulse RSS sources, currency API, and weather API were not independently checked.
- No Playwright/Cypress browser E2E suite exists to run.
- No UAT sign-off was performed; it requires business stakeholders.
- OWASP ZAP or equivalent DAST was not run.
- Gitleaks/trufflehog full-history scanning was not run because neither tool is installed.
- .NET dependency vulnerability scanning was blocked by NuGet network access.
- No isolated Mongo migration execution or idempotence test was possible because no migration scripts/runner exist.
- No production `/data/sales` re-index and MD5 stability rehearsal was run; only the existing deterministic unit tests passed.
- No image rollback, Mongo backward-compatibility, `/data` restore, TLS issuance, firewall, or Caddy routing test was run.
- Frontend production build did not complete in the offline environment due to Google Fonts fetch failure.

