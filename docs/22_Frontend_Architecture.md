# 22 — Frontend Architecture

## Purpose
Describe how the Next.js application is structured internally, so new routes/components land in the right place and follow existing conventions.

## Scope
`frontend/` internals: routing, state/context, API client, typing. Not visual design (see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)/[21_Design_Tokens.md](21_Design_Tokens.md)) or component catalogue (see [20_Component_Library.md](20_Component_Library.md)).

## Responsibilities
- Define the route structure and where new pages go.
- Define state-management conventions (context usage today; no external state library).
- Define the API-client contract between frontend and backend.

## Architecture
Next.js 16, App Router, React 19, TypeScript. Route group `(app)/` holds every authenticated module route; `login/` sits outside it. No `zustand`/`redux`/`react-query` — state is React Context (`CatalogueContext` for active catalogue + list, `ThemeModeContext` for light/dark) plus component-local state and direct fetches.

```
frontend/src/
  app/
    (app)/            one folder per module route — dashboard, catalogue, valuation,
                       worksheet, analysis, reports, broker, market, knowledge,
                       assistant, saved-filters, saved-reports, data-import,
                       exports, settings, help
    login/
    manifest.ts        PWA manifest
  components/           see 20_Component_Library.md
  context/              CatalogueContext, ThemeModeContext
  lib/                  api.ts (typed fetch client), format.ts
  theme/                MUI theme + ThemeRegistry (App Router cache provider)
  types/                TypeScript types mirroring API DTOs
public/
  sw.js                 service worker (cache-first for /_next/static/ only)
  icons/                 PWA icons
```

## UI behaviour
Not applicable directly — see linked design docs.

## Business rules
- **No direct data access from components.** All backend communication goes through `lib/api.ts`'s typed client — this is what keeps a future API contract change a one-file update instead of a grep-and-replace across every page.
- **Types mirror API DTOs** (`types/`) — when the backend DTO shape changes, update the mirrored type in the same change, not later.
- **Route ↔ nav parity**: every route under `(app)/` must have a corresponding entry in `components/shell/nav.ts` — see [04_Navigation_Architecture.md](04_Navigation_Architecture.md).
- **`(app)/page.tsx` redirects to `/dashboard`** — there is no separate "home" distinct from the dashboard/launchpad.

## Dependencies
[01_System_Architecture.md](01_System_Architecture.md), [24_API_Guidelines.md](24_API_Guidelines.md) (contract the typed client implements), [04_Navigation_Architecture.md](04_Navigation_Architecture.md), [20_Component_Library.md](20_Component_Library.md).

## Future expansion
Adopt a data-fetching/caching library (e.g. React Query/SWR) if manual fetch+state duplication across pages becomes a real pain point — not needed yet given current app size, but worth revisiting if page count or fetch complexity grows significantly.

## Implementation notes
`frontend/AGENTS.md` (included via `frontend/CLAUDE.md`) carries an important warning: this Next.js version has breaking changes vs. training-data assumptions — check `node_modules/next/dist/docs/` before writing App Router code that assumes older/more familiar conventions.

## Open questions
- No documented data-fetching pattern (server components vs. client components + `lib/api.ts`) is captured here — verify actual pattern in a real route file (e.g. `app/(app)/dashboard/page.tsx`) before assuming server-component data fetching is or isn't used.

## Best practices
- New route → new folder under `(app)/` + new `NAV_ITEMS` entry + new numbered module doc if it's a real module (not a sub-view of an existing one).
- Extend `CatalogueContext`/`ThemeModeContext` rather than introducing a new ad hoc context for cross-cutting state; introduce a new context only for genuinely separate concerns.
