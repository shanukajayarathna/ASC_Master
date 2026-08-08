# 24 — API Guidelines

## Purpose
Set conventions for designing new API endpoints so the surface stays predictable across both the legacy Controllers and the newer Modules layers.

## Scope
HTTP API design conventions: routing, versioning, auth, error shapes, DTOs. Not the internal service architecture behind an endpoint (see [23_Backend_Architecture.md](23_Backend_Architecture.md)).

## Responsibilities
- Define routing/versioning conventions for new endpoints.
- Define the expected auth posture for a new endpoint.
- Define request/response conventions (DTOs, error shapes) new endpoints should follow.

## Architecture
Two coexisting conventions in the live codebase:
- **Legacy**: unversioned `api/...` routes (`CataloguesController`, `LotsController`, etc.).
- **Current**: versioned `api/v1/...` routes under `Modules/` (Analytics, Market, Reports, Assistant, Documents, Auth, ApiKeys, Webhooks, FilterPresets).

New endpoints should use the `api/v1/...` convention under a `Modules/` folder — see [23_Backend_Architecture.md](23_Backend_Architecture.md).

## UI behaviour
Not applicable — backend contract document, consumed by `frontend/src/lib/api.ts` and `frontend/src/types/`.

## Business rules
- **Auth by default.** Every new endpoint is `[Authorize]`-gated unless there's a specific, documented reason it must be public (there is no known legitimate case for a new endpoint being unauthenticated in this platform today — the six-controller gap fixed in commit `c1c5cc3` is the cautionary example, not a precedent to repeat). Admin-only capabilities (user/role management, API keys, webhooks, dev seeding) use an explicit Admin role policy.
- **API-key-compatible where relevant.** Endpoints intended for external automation (n8n-style) should work under the `X-Api-Key` scheme, not just JWT — check `ApiKeyAuthenticationHandler`'s policy scheme before assuming JWT-only.
- **DTOs, not domain models, on the wire.** Response/request shapes should be explicit DTOs (mirrored into `frontend/src/types/`), not raw Mongo/domain entities, so internal model changes don't silently break the frontend contract.
- **Errors are structured and mapped to real HTTP status codes** (400 for validation, 401/403 for auth, 404 for missing resources, 409 for conflicts) — not a blanket 500 with a message string, and not a 200 with an error field buried in the body.
- **Optimistic concurrency on any multi-editor write path.** `LotsController.UpdateValuation` (`PATCH api/lots/{id}/valuation`) is the reference pattern: the client echoes back the last-seen `UpdatedAt` (`ExpectedUpdatedAt`); a mismatch returns `409 Conflict` with a payload carrying current server state (`ValuationConflictDto`), so the client can show the conflict instead of silently clobbering someone else's write. Any new endpoint where two users could plausibly edit the same record concurrently (not just valuations) should follow this same shape rather than last-write-wins.
- **Metrics/analytics-shaped endpoints should ultimately be thin wrappers over the shared analytics engine / metrics registry** ([06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md)) rather than embedding their own aggregation logic, once that layer exists.

## Dependencies
[23_Backend_Architecture.md](23_Backend_Architecture.md), [18_Security.md](18_Security.md), [22_Frontend_Architecture.md](22_Frontend_Architecture.md) (the typed client consuming these contracts), [25_Coding_Standards.md](25_Coding_Standards.md).

## Future expansion
Migrating legacy unversioned routes to `v1` for full consistency (see [23_Backend_Architecture.md](23_Backend_Architecture.md)'s future-expansion note); OpenAPI/Swagger is already available (`/swagger` per root README) — consider it the living contract reference and keep it accurate rather than duplicating full endpoint lists into this document.

## Implementation notes
Swagger UI is available at `/swagger` when running the API locally (`http://localhost:5058/swagger`) — treat it as the authoritative, always-current endpoint list; this document captures conventions and rules, not an endpoint inventory that will drift out of date.

## Open questions
- No documented pagination convention for list endpoints (e.g. lots list) — verify current behaviour (full result vs. paged) against `LotsController` before assuming either.
- No documented rate-limiting policy beyond login (10/min/IP) — should other write-heavy endpoints (bulk-classify, import) have limits too?

## Best practices
- Check Swagger before assuming an endpoint doesn't exist.
- New endpoint → `api/v1/...` under `Modules/`, explicit auth policy, DTO request/response, structured error handling, mirrored TypeScript type.
