# 03 — Dashboard Experience

## Purpose
Define what the Dashboard (the app's home base, `/dashboard`) shows and why, so widget additions stay coherent instead of turning the home screen into a dumping ground.

## Scope
The `/dashboard` route and its constituent widgets (`frontend/src/components/home/`, `frontend/src/components/dashboard/`). Not the launchpad's module tile grid, which is navigation, not dashboard content — see [04_Navigation_Architecture.md](04_Navigation_Architecture.md).

## Responsibilities
- Define the dashboard's layout and the intent behind each widget.
- Keep the dashboard "honest" — i.e., every number shown is live, not placeholder/demo data (per commit `f85b306`, "honest live dashboard").
- Set rules for what belongs on the dashboard vs. what belongs on a dedicated module page.

## Architecture
Composed of widget components under `frontend/src/components/home/`: `AutoSlidingKpiPanel`, `AiInsightsPanel`, `AttentionList`, `RecentActivityList`, `RecentList`, `ModuleTile`, `Sparkline`, plus `frontend/src/components/dashboard/` (`KpiTile`, `KpiSection`). All data is fetched from the API (`DashboardController` at `api/catalogues/{id}/dashboard`, and where relevant, `Modules/Analytics`) — no widget should hardcode sample data.

## UI behaviour

### Dashboard layout
Single-page composition, not a customisable grid (see "Customization" below). KPI panel at the top (auto-sliding through executive metrics), followed by AI insights, attention items, and recent activity — most-important-first ordering.

### Executive KPIs
Computed from the active sale's lots and valuations (`AutoSlidingKpiPanel`, backed by `DashboardController`/`Analytics`). Examples: total lots, valued vs. unvalued, average valuation, completion percentage. These must be sourced from the shared analytics/metrics layer once it exists ([06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md)) rather than computed ad hoc in the widget.

### Quick Actions
Fast paths to the most common next step (e.g. jump into valuing unvalued lots) — implemented via `AttentionList`, which surfaces items needing action rather than being a static shortcut menu.

### Module tiles
The dashboard itself does not duplicate the launchpad's tile grid; `ModuleTile` as used here is for a small "jump back in" affordance, not the primary navigation surface. Primary module navigation is the dedicated launchpad — see [04_Navigation_Architecture.md](04_Navigation_Architecture.md).

### AI panel
`AiInsightsPanel` — surfaces AI Assistant-generated observations about the current sale (e.g. notable outliers, broker shifts). Must be clearly attributed as AI-generated and must not be the only place a critical number appears (see [08_AI_Assistant.md](08_AI_Assistant.md) for grounding rules).

### Recent activity
`RecentActivityList` / `RecentList` — recent valuations, imports, or report generations, giving a sense of "what happened since I last looked" without requiring a dedicated audit-log page.

### Notifications & timeline
No dedicated notification centre or activity timeline exists today beyond `RecentActivityList`. Treat as a future-expansion item (see below), not a currently implemented feature.

### Widgets
Each widget owns its own data fetch and loading/error state; the dashboard page composes them but does not centrally orchestrate their loading (per current React/Next.js data-fetching conventions in this codebase — verify against `frontend/src/app/(app)/dashboard/` before assuming otherwise).

### System health
No system-health widget (API status, Mongo connectivity, etc.) exists today. Future expansion item — would be useful given the platform's dependency on MongoDB and OpenAI being reachable.

### Customization
Not implemented — the dashboard layout is fixed, not user-configurable. If customisation is requested, it should be scoped as a new capability (user-specific widget layout, persisted via Mongo) rather than assumed to exist.

## Business rules
- Every widget must reflect the **active sale/catalogue** context, consistent with the rest of the app (see [09_Catalogue_Manager.md](09_Catalogue_Manager.md) for how "active catalogue" is scoped via `CatalogueContext`).
- No widget should show static/sample data in production — this was an explicit fix (commit `f85b306`), not a stylistic preference, and regressing it should be treated as a bug.

## Dependencies
[06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md), [08_AI_Assistant.md](08_AI_Assistant.md), [04_Navigation_Architecture.md](04_Navigation_Architecture.md).

## Future expansion
Notification centre, system-health widget, per-user dashboard customisation, drill-down from a KPI tile straight into the filtered Catalogue Manager view.

## Implementation notes
`frontend/src/app/(app)/dashboard/` is the route; `frontend/src/components/home/` and `frontend/src/components/dashboard/` hold the widgets.

## Open questions
- Should dashboard KPIs be scoped to a single active sale only, or support a rolling/multi-sale executive view? Not decided in code today.

## Best practices
- New widgets fetch live data from the API — never hardcode example numbers, even during development.
- Keep the dashboard focused on "what needs my attention now" — move anything exploratory or filter-heavy to a dedicated module page instead of growing the dashboard indefinitely.
