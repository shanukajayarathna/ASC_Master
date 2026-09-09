# Pre-Deployment Remediation Summary

Audit basis: `PRE_DEPLOYMENT_CHECK.md`, run 2026-09-07.

## Fixed

- **A3 Frontend lint:** resolved the reported React Hooks, Next.js link, and unused-import findings. `npm run lint` exits 0.
- **A2 Frontend tests:** added Vitest, jsdom, React Testing Library, setup files, scripts, and focused tests for sharing display data, public-page logout behavior, and Reports hub navigation. `npm run test` passes 5 tests.
- **A1 Backend baseline:** added deterministic security-boundary tests covering role vocabulary, auth bootstrap and admin policy metadata, access-request exposure, audit-log protection, and entity defaults. The full suite passes 266 tests with 2 existing local-LLM skips.
- **B1 SCA:** enabled `eslint-plugin-security` and `Meziantou.Analyzer`. The .NET vulnerable-package scan completed without reporting vulnerable packages.
- **B2 Mongo boundary tracking:** documented the direct-Mongo controller refactor scope in `docs/18_Security.md`; no broad controller rewrite was attempted.
- **B3 Edge headers:** added conservative CSP and Permissions-Policy headers in `deploy/Caddyfile`.
- **C1 Migrations:** added a numbered Mongo migration runner, migration history collection, startup execution, and idempotence coverage.
- **C2 Rollback:** added immutable backend/frontend image selection, compose rollback script, data archive guidance, Mongo compatibility checks, and post-rollback smoke steps.
- **C3 Fonts:** self-hosted the Google font assets used by the frontend. Production build completed successfully.
- **C4 PDF tracing:** scoped Next.js output tracing to the two LibreOffice PDF routes and preserved the explicit Turbopack ignore for the binary resolver. Production build completed successfully.

## Deferred

- **A1 breadth:** full happy-path and edge-case controller coverage for every remaining module is still deferred. The current baseline intentionally starts with Auth, Access Requests, and Audit boundaries; Mongo-backed integration fixtures are not yet present.
- **B1 warning cleanup:** analyzer output is enabled but existing findings remain as warnings, including object-injection heuristics, unsafe-regex heuristics, file/type naming, and collection/style rules. They were not suppressed.
- **B2 refactor:** direct Mongo access remains in the documented controllers pending an API/repository boundary decision.
- **C2 operational rehearsal:** rollback has not been exercised against a production-like deployment with real image digests and data archives.

## Unverifiable In This Environment

- DAST against a deployed HTTPS environment.
- Secret-history scanning with Gitleaks or TruffleHog.
- Live Mongo index and migration execution against the production-like database.
- Real AI-provider configuration, rate-limit behavior, and provider failover.
- Full UAT with operator accounts and representative sale files.
- Post-deployment smoke tests, backup restore rehearsal, and monitoring verification.
- Production validation of LibreOffice PDF generation inside the final container image.

## Verification Commands

- `frontend`: `npm run lint`
- `frontend`: `npm run test`
- `frontend`: `npm run build`
- `backend`: `dotnet test backend\\Asc.Api.Tests\\Asc.Api.Tests.csproj --no-restore`
- `backend`: `dotnet list backend\\Asc.Api\\Asc.Api.csproj package --vulnerable --include-transitive --format json`
- `docker compose config --quiet`

## Commit Groups

- `50d476e` A3 frontend lint fixes
- `4782f92` C3 self-hosted fonts
- `6d3ed8e` C4 PDF tracing
- `c96cf87` B1 analyzers
- `ba1c846` B3 edge policies
- `e7cd8a4` B2 tracking note
- `250d0a4` C1 migration runner
- `64e08a1` C2 rollback runbook
- `b38a250` A2 frontend test harness
- `2f77e02` A1 backend security baselines
- `91f8bc8` frontend test mock cleanup
