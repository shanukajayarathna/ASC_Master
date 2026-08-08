# 25 — Coding Standards

## Purpose
Set concrete, checkable conventions for naming, structure, and code style across both the .NET backend and the Next.js/TypeScript frontend.

## Scope
Code-level conventions. Architecture-level decisions (where a file lives) are covered in [22_Frontend_Architecture.md](22_Frontend_Architecture.md)/[23_Backend_Architecture.md](23_Backend_Architecture.md); this document is about how code within a file is written.

## Responsibilities
- Naming conventions (files, folders, components, hooks, services).
- TypeScript/C# style expectations.
- Error handling, logging, comments, and reuse philosophy.

## Architecture
Not applicable — this document is style/convention, not structure.

## UI behaviour
Not applicable.

## Business rules

### Naming
- **Frontend**: PascalCase for components (`ModuleTile.tsx`), camelCase for hooks/utilities, kebab-case or lowercase for route folders (matching Next.js App Router conventions, e.g. `saved-reports/`).
- **Backend**: PascalCase for classes/controllers/methods (`CataloguesController`, `SaleFileStore`), matching standard .NET convention.
- Route/module names should match across layers where possible: a `Modules/Market` backend module backs a `/market` frontend route and a "Market Intelligence" nav label — keep the concept traceable across all three ([04_Navigation_Architecture.md](04_Navigation_Architecture.md)).

### Folders
Follow the existing structure in [22_Frontend_Architecture.md](22_Frontend_Architecture.md)/[23_Backend_Architecture.md](23_Backend_Architecture.md) — feature-area folders (`components/catalogue/`, `Modules/Analytics/`), not a flat dump or a premature deeply-nested hierarchy.

### Components
One component per file, named to match the file. Presentational logic in the component; data-fetching/business logic delegated to `lib/api.ts` calls or context, not inlined ad hoc `fetch` calls scattered across components.

### Hooks
Custom hooks (if/when introduced) prefixed `use`, colocated with the feature that owns them unless genuinely shared, in which case promote to a shared location.

### Services
Backend: `Services/` for cross-cutting logic not tied to a single controller/module (e.g. `CatalogueImportService`, `SaleFileStore`, `LotMediaStore`). A service should have one clear responsibility — resist folding unrelated logic into an existing service just because it's convenient.

### Repositories
No formal repository abstraction layer exists over MongoDB today — `MongoContext` exposes collection accessors directly to modules/controllers. Don't introduce a generic repository pattern speculatively; only add one if a genuine cross-cutting data-access need (e.g. swapping Mongo for Postgres, per the root README's noted possibility) actually materialises.

### Dependency injection
Standard ASP.NET Core DI (constructor injection) throughout the backend — services and data contexts are registered and injected, not statically accessed or newed up inside controllers/modules.

### TypeScript
Strict typing expected — API DTOs mirrored in `frontend/src/types/`, not `any`-typed. Prefer explicit interface/type definitions over inferred shapes for anything crossing a module boundary.

### Error handling
Backend: structured errors mapped to correct HTTP status codes (see [24_API_Guidelines.md](24_API_Guidelines.md)) — don't swallow exceptions silently. Frontend: surface API errors to the user visibly (especially for write operations like valuation save, bulk actions, imports) rather than failing silently — per [09_Catalogue_Manager.md](09_Catalogue_Manager.md)'s bulk-action rule.
Per this repo's general engineering philosophy: don't add error handling for scenarios that can't actually happen — validate at real boundaries (user input, external API responses, file parsing), not defensively everywhere.

### Logging
No dedicated structured-logging framework/convention is documented in this repo today — use ASP.NET Core's built-in `ILogger<T>` where logging is needed, and avoid `Console.WriteLine`-style ad hoc output in committed code.

### Accessibility
See [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)'s accessibility section — semantic MUI components, keyboard operability, sufficient contrast in both themes.

### Testing
See [26_Testing_Strategy.md](26_Testing_Strategy.md).

### Comments
Default to no comments. Add one only when the *why* isn't obvious from the code itself — a non-obvious constraint, a workaround, a hand-kept invariant (e.g. the existing comment in `tokens.ts` explaining why it must mirror `globals.css` by hand is a good example of a comment worth keeping: it states a non-obvious constraint, not what the code visibly does).

### Documentation
Update the relevant `/docs` file in the same change as any behaviour change it describes — see the root [`docs/README.md`](README.md)'s "how future contributors should use these specifications."

### Performance
See [19_Performance.md](19_Performance.md) for known seams; don't pre-optimise beyond documented, real bottlenecks.

### Reuse
Before writing new logic, check: does `Modules/Analytics` already compute this? Does `components/shared/` already have this pattern? Does the metrics registry (once it exists) already define this number? Duplication is the default failure mode this whole `/docs` set exists to prevent (see [00_Project_Vision.md](00_Project_Vision.md), "One number, one source").

## Dependencies
[22_Frontend_Architecture.md](22_Frontend_Architecture.md), [23_Backend_Architecture.md](23_Backend_Architecture.md), [24_API_Guidelines.md](24_API_Guidelines.md), [26_Testing_Strategy.md](26_Testing_Strategy.md).

## Future expansion
A linter/formatter configuration reference, if/when one is standardised beyond whatever ESLint config ships with `create-next-app`'s defaults (`eslint-config-next` is already a dependency — confirm current rule set before assuming custom rules exist).

## Implementation notes
Not applicable beyond what's stated above.

## Open questions
- No documented C# style/analyzer configuration (e.g. `.editorconfig`, Roslyn analyzers) was confirmed — check `backend/Asc.Api` for one before assuming defaults only.

## Best practices
- Small, direct code over premature abstraction — no repository pattern, no feature flags, no speculative extensibility until a real second use case exists.
- Update docs and code together, in the same change.
- When two places need the same logic, extract and share it immediately — don't wait for a third occurrence.
