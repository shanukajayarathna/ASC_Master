# 20 — Component Library

## Purpose
Catalogue the platform's reusable UI components so new screens are assembled from existing building blocks instead of each module reinventing cards, tiles, or tables independently.

## Scope
Shared/reusable components under `frontend/src/components/`. Not one-off, module-specific composition (e.g. the specific layout of the Reports page) — only pieces meant for reuse.

## Responsibilities
- Track what reusable components exist, where, and their intended usage.
- Flag where duplication has crept in and should be consolidated.

## Architecture
Organised by feature area under `frontend/src/components/`:
- `shell/` — `Shell` (app frame), `Topbar`, `CommandPalette`, `nav.ts` (config, not a component), `BrandLogo`.
- `home/` — dashboard/launchpad widgets: `ModuleTile`, `AutoSlidingKpiPanel`, `AiInsightsPanel`, `AttentionList`, `RecentActivityList`, `RecentList`, `Sparkline`.
- `dashboard/` — `KpiTile`, `KpiSection`.
- `catalogue/` — `CatalogueGrid` (AG Grid wrapper), `ValuationDrawer`, grid theme setup.
- `valuation/` — Valuation Centre-specific components (list + focus mode).
- `analytics/` — Analysis-page chart/breakdown components.
- `shared/` — cross-module generics.

## UI behaviour
Every component here should follow [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) and consume [21_Design_Tokens.md](21_Design_Tokens.md) values rather than hardcoding colors/spacing.

## Business rules
Not applicable — components are presentation, not business logic; they should receive data/behaviour via props, not fetch or compute business rules internally beyond simple display formatting.

### Component documentation, per component (fill in as each is touched/extended)

**ModuleTile** (`components/home/ModuleTile.tsx`)
- Purpose: render a single launchpad tile — icon, gradient/photo background, label, description, live/soon status.
- Props (verify exact shape in source): a `NavItem`-shaped object (see [04_Navigation_Architecture.md](04_Navigation_Architecture.md)).
- Variants: with photo vs. gradient-only fallback.
- Accessibility: must remain a real link/button (keyboard-navigable), not a div with an onClick.
- Usage: launchpad grid, and the Dashboard's "jump back in" affordance ([03_Dashboard_Experience.md](03_Dashboard_Experience.md)).

**CommandPalette** (`components/shell/CommandPalette.tsx`)
- Purpose: `Ctrl/Cmd+K` fuzzy search over `NAV_ITEMS`.
- Accessibility: must trap focus while open, close on `Escape`, and be fully keyboard-operable (no mouse-only path to any result).

**CatalogueGrid** (`components/catalogue/`)
- Purpose: AG Grid Enterprise wrapper bound to lot data, with column/filter side panel and row selection.
- Usage guideline: this is the canonical grid pattern — any future tabular view (e.g. a Reports data table) should extend or reuse this wrapper's theming/config rather than configuring AG Grid from scratch.

**ValuationDrawer** (`components/catalogue/`, reused by `valuation/`)
- Purpose: the value/classify/remarks form, usable both from the grid (drawer) and the Valuation Centre's own flows.
- Note: this dual-use is intentional — don't fork it into two separate implementations when the Valuation Centre and Catalogue Manager need the same form.

**KpiTile / KpiSection** (`components/dashboard/`)
- Purpose: single-metric display tile and a grouping of them.
- Usage guideline: once [07_Metrics_Registry.md](07_Metrics_Registry.md) exists, `KpiTile` should accept a metric identifier + filter set and let the registry supply the value, rather than being handed a pre-computed number by ad hoc parent logic.

**Charts / breakdown components** (`components/analytics/`)
- Currently implemented per-module rather than as a single shared chart primitive — see [05_Business_Intelligence.md](05_Business_Intelligence.md)'s note on this. Extract a shared `Chart`/`Sparkline`-family component here if duplication across Analysis/Broker/Market grows.

**Shared/generic components** (`components/shared/`)
- Cross-cutting pieces (e.g. empty states, loading/skeleton states). Confirmed by direct source check: `ComingSoon.tsx` still exists here but is **not imported by any route under `app/`** — it's dead code left over from the sidebar-era build, when several modules genuinely were placeholders (see [01_System_Architecture.md](01_System_Architecture.md)). Since every module is now live, this component has no live call site. Safe to delete next time this folder is touched; not deleted here since this pass is documentation-only and the instruction was not to change functionality.

### Categories still needing dedicated components (per the enterprise template's expected list)
Dialogs, standalone form primitives beyond `ValuationDrawer`, a generic search/filter bar, drawers beyond `ValuationDrawer`, dedicated "AI card" presentation (distinct from `AiInsightsPanel`), a generic timeline component (distinct from `RecentActivityList`), badges, empty states, and skeleton loaders are not confirmed as extracted, reusable components today — verify against `components/shared/` before building a new one-off, and extract to `shared/` the first time a second module needs the same pattern.

## Dependencies
[02_UI_UX_Design_System.md](02_UI_UX_Design_System.md), [21_Design_Tokens.md](21_Design_Tokens.md), [22_Frontend_Architecture.md](22_Frontend_Architecture.md).

## Future expansion
Extract shared chart/table/empty-state/skeleton primitives as duplication across modules is identified; formalise this document with real prop tables once each component is next touched (treat that as the trigger to fill in this doc's gaps, per the root README's "documentation and implementation remain synchronized" workflow).

## Implementation notes
This document is intentionally incomplete where the underlying component's exact props/variants weren't directly inspected — marked as "verify in source" rather than guessed, in line with this doc set's ground-truth policy.

## Open questions
None outstanding as of this update — the `components/shared/` liveness question above was resolved by direct source check.

## Best practices
- Before building a new component, check `components/shared/` and the relevant feature folder first.
- The first time a pattern is needed by a second module, extract it to `shared/` rather than copy-pasting.
- Update this document's per-component entry whenever you meaningfully change that component's props or behaviour.
- Dead code found while documenting (like `ComingSoon.tsx`) should be noted here with its actual status rather than silently deleted during a docs-only pass — flag it, let a follow-up change remove it deliberately.
