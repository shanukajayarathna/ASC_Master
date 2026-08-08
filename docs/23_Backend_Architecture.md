# 23 — Backend Architecture

## Purpose
Describe how `backend/Asc.Api` is structured internally — the Controllers/Modules split, data access patterns — so new backend work lands in the right place.

## Scope
`backend/Asc.Api` internals. Not deployment/infrastructure (not documented anywhere in this repo today — no Dockerfile/CI pipeline observed as of this writing) and not API contract conventions (see [24_API_Guidelines.md](24_API_Guidelines.md)).

## Responsibilities
- Define the Controllers vs. Modules organisational split and when to use each.
- Define data-access conventions (file store vs. Mongo).
- Track auth wiring at the architecture level (detail in [18_Security.md](18_Security.md)).

## Architecture
ASP.NET Core (.NET 9) Web API, two coexisting organisational layers:

```
backend/Asc.Api/
  Controllers/        legacy/original surface, unversioned routes (api/...)
    CataloguesController, LotsController, DashboardController,
    LotMediaController, ExportController, DevSeedController (Admin-only)
  Modules/             newer feature-module pattern, versioned routes (api/v1/...)
    Analytics, Market, Reports, Assistant, Documents,
    Auth, ApiKeys (Admin-only), Webhooks (Admin-only), FilterPresets
  Models/              Catalogue, Lot (embeds Valuation), FilterPreset, ActualPrice, SavedReport
  Data/                MongoContext (MongoDB.Driver client + collection accessors)
  Services/            SaleFileStore/ICatalogueSource (file-based catalogue reads),
                       CatalogueImportService (xlsx/csv parsing), LotMediaStore
```

## UI behaviour
Not applicable — backend-only.

## Business rules
- **New features default to the Modules pattern** (`Modules/<Feature>`, `api/v1/<feature>`), not the legacy Controllers surface — this is the direction the codebase has already been moving (Analytics, Market, Reports, Assistant, Documents, Auth, ApiKeys, Webhooks, FilterPresets were all added this way).
- **Data-access boundary**: catalogue/lot data is read via `SaleFileStore`/`ICatalogueSource`, never written to or read from MongoDB directly by a controller — see [01_System_Architecture.md](01_System_Architecture.md). User-entered/system state (valuations, users, reports, documents, conversations, API keys, webhooks) goes through `MongoContext`.
- **Auth**: apply `[Authorize]` (or an explicit, documented exception) to every new controller/module endpoint — see [18_Security.md](18_Security.md) for the policy and the historical gap it fixed (commit `c1c5cc3`).
- **No schema/migration step for Mongo** — collections and indexes are created on first write. Don't add a manual migration step unless a genuine schema-versioning need arises.

## Dependencies
[01_System_Architecture.md](01_System_Architecture.md), [18_Security.md](18_Security.md), [24_API_Guidelines.md](24_API_Guidelines.md), [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md) (target home for consolidated analytics logic — likely a new `Modules/Metrics` or refactored `Modules/Analytics`).

## Future expansion
Migrating the legacy `Controllers/` surface (`CataloguesController`, `LotsController`, `DashboardController`, `LotMediaController`, `ExportController`) to the `Modules/` pattern for consistency, if/when those areas need significant new work anyway — not worth a dedicated migration project on its own.

## Implementation notes
`DevSeedController` (`api/dev`) is Admin-only and exists for dev/test seams — never expose it without auth, and never rely on it in a production data path.

## Open questions
- No CI/CD pipeline or deployment configuration is present in this repo as of this writing — infrastructure/deployment architecture is entirely undocumented. Add a doc for this once a deployment target is chosen.

## Best practices
- New backend feature → new `Modules/<Feature>` folder, `api/v1/<feature>` route prefix, explicit `[Authorize]`.
- Never add catalogue/lot business data to a Mongo collection — extend the file-store model instead, or raise the question explicitly if file-based storage is becoming limiting.
