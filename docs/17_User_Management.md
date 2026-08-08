# 17 — User Management

## Purpose
Define how users, roles, API keys, and outbound webhooks are administered — the platform's identity and external-integration surface.

## Scope
The Settings page's user/role/API-key/webhook sections, `AuthController`, `Modules/ApiKeys`, `Modules/Webhooks`. Authentication mechanics themselves (JWT, password hashing, rate limiting) are covered in depth in [18_Security.md](18_Security.md); this document covers the *administration* of users and integrations.

## Responsibilities
- Let admins manage users, roles, and passwords.
- Let admins issue/revoke API keys for external tools.
- Let admins configure outbound webhook subscriptions (n8n-style automation).

## Architecture
Frontend: `frontend/src/app/(app)/settings/`. Backend: `AuthController` (`api/v1/auth` — register/login/me/users/role/delete/change-password), `Modules/ApiKeys` (`api/v1/api-keys`, Admin-only), `Modules/Webhooks` (`api/v1/webhooks`, Admin-only). Users persist to MongoDB (`users`), API keys to `apiKeys`, webhook subscriptions to `webhookSubscriptions`.

## UI behaviour
Settings page sections: Users (list, role assignment, deletion), self-service password change (any user, for their own account), API Keys (Admin-only — issue/revoke), Webhooks (Admin-only — configure outbound event subscriptions), Appearance (light/dark theme — see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)).

## Business rules
- Role management (assigning/changing a user's role), user deletion, API key issuance, and webhook configuration are **Admin-only** — enforced server-side (`[Authorize(Roles = "Admin")]`-style policies), not just hidden in the UI.
- API keys authenticate via the `X-Api-Key` header through a distinct policy scheme from interactive JWT auth — built specifically for external automation (n8n), not for human login. Treat a leaked API key with the same severity as a leaked admin password.
- Webhooks are **outbound only** (the platform notifies external systems of events) — this is not an inbound integration surface.

## Dependencies
[18_Security.md](18_Security.md) (auth mechanics this module administers), [08_AI_Assistant.md](08_AI_Assistant.md)/[15_Knowledge_Base.md](15_Knowledge_Base.md) (share the Admin-gated user model for access control, if/when document access becomes role-scoped).

## Future expansion
Finer-grained roles beyond a binary Admin/non-Admin split, if usage shows a need (e.g. a "valuer" role that can't manage users but can bulk-classify); webhook delivery retry/failure visibility in the UI.

## Implementation notes
Backend routes: `api/v1/auth/*`, `api/v1/api-keys/*` (Admin-only), `api/v1/webhooks/*` (Admin-only). Login rate-limited to 10/min/IP (see [18_Security.md](18_Security.md)).

## Open questions
- Is there an audit trail for Admin actions (role changes, API key issuance/revocation)? Not confirmed — worth adding if not present, given these are high-privilege actions.

## Best practices
Any new Admin-only capability must enforce the role check server-side in the endpoint itself, not rely solely on the Settings UI hiding the control from non-Admins.
