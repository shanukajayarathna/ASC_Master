# 18 — Security

## Purpose
Record the platform's actual security posture as a single reference, so new endpoints are built to the same standard rather than each contributor re-deriving what "secure enough" means here.

## Scope
Authentication, authorization, secrets handling, and rate limiting, across both the legacy `Controllers/` surface and the newer `Modules/` surface. Detailed administration UI is covered in [17_User_Management.md](17_User_Management.md); this document covers the mechanics and policy.

## Responsibilities
- State the current auth model precisely.
- Record known gaps so they aren't silently rediscovered (or silently assumed fixed).
- Set the baseline every new endpoint must meet.

## Architecture
Two coexisting auth schemes, selected by a policy scheme: **JWT bearer** (interactive users, `AuthController`, `PasswordHasher<AppUser>`, roles via `ClaimTypes.Role`) and **API key** (`ApiKeyAuthenticationHandler`, reads `X-Api-Key` header, for external automation like n8n). Almost every controller carries `[Authorize]`; Admin-only policies gate `DevSeedController`, `Modules/ApiKeys`, `Modules/Webhooks`, and the role/user-management endpoints in `AuthController`.

## UI behaviour
Login is required to use the app (commit `ec96746`, "Gate the app behind login, redesign the login screen") — there is no anonymous/guest mode. Session state (JWT) is held client-side and attached to every API request via the typed fetch client.

## Business rules
- **Login rate limiting**: 10 attempts/minute/IP on `api/v1/auth/login`.
- **Secrets never committed**: `Jwt:Key` and `OpenAI:ApiKey` are set via `dotnet user-secrets`, never written to `appsettings.json` (which is committed). Any change that adds a new secret must follow this same pattern.
- **Security hardening history matters**: commit `c1c5cc3` ("Security audit: close six unauthenticated controllers, harden auth") fixed a real prior gap — six controllers were reachable without authentication. Treat "is this endpoint `[Authorize]`-gated?" as a mandatory check for every new controller/module, not an optional one, given this already happened once.
- **Legacy endpoints are now confirmed closed** — the root README previously stated pre-existing catalogue/lot/valuation endpoints were "deliberately" left open pending a separate rollout; that was stale. Verified directly against source (`grep -n "\[Authorize\]" backend/Asc.Api/Controllers/*.cs`): `CataloguesController`, `LotsController`, `DashboardController`, `LotMediaController`, and `ExportController` all carry `[Authorize]`; `DevSeedController` carries `[Authorize(Roles = "Admin")]`. The `c1c5cc3` hardening pass did cover these. Root README updated to match.
- **Optimistic concurrency on valuation writes**: `LotsController.UpdateValuation` (`PATCH api/lots/{id}/valuation`) is not just auth-gated — it also guards against lost-update races. `ValuationUpdateDto.ExpectedUpdatedAt` must match the currently-stored valuation's `UpdatedAt`; a mismatch returns `409 Conflict` with a `ValuationConflictDto` carrying the lot as it actually stands, rather than silently overwriting a concurrent edit. This is a correctness/data-integrity control as much as a security one — worth knowing before assuming "authorized" is the only thing standing between a user and a bad write. See [10_Valuation_Centre.md](10_Valuation_Centre.md).
- API keys are equivalent in trust level to an Admin credential for whatever scope they're issued — revoke immediately on suspected compromise ([17_User_Management.md](17_User_Management.md)).

## Dependencies
[17_User_Management.md](17_User_Management.md), [23_Backend_Architecture.md](23_Backend_Architecture.md), [24_API_Guidelines.md](24_API_Guidelines.md) (new-endpoint checklist should reference this doc).

## Future expansion
Audit logging for Admin actions (role changes, API key/webhook management — see [17_User_Management.md](17_User_Management.md)'s open question); formal security review cadence (this platform has a `security-review` capability available in-repo tooling — use it periodically, not just at redesign milestones).

## Implementation notes
`ApiKeyAuthenticationHandler` and the JWT scheme are both configured in the API's startup/`Program.cs` — confirm exact policy names there before adding a new `[Authorize(Policy = ...)]` attribute.

## Open questions
- No documented policy on JWT expiry/refresh — verify against `AuthController` before relying on any assumption here.

## Best practices
- Every new controller or module endpoint gets an explicit `[Authorize]` (or documented, deliberate exception) — never rely on "it'll inherit something" or add it later.
- Never commit a real secret to `appsettings.json` — user-secrets locally, environment/secret-manager in any deployed environment.
- When touching `CataloguesController`, `LotsController`, `DashboardController`, or `LotMediaController`, check their current auth status and update this document's "legacy endpoints" note to match reality.
