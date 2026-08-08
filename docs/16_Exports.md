# 16 — Exports

## Purpose
Define the module for building a custom Excel export from an arbitrary lot selection, distinct from Reports' fixed report types.

## Scope
The `/exports` route and `ExportController` (`api/export/excel`). Not fixed-format reports (see [13_Reports.md](13_Reports.md)) and not the Catalogue Manager grid's own built-in AG Grid CSV/Excel export (a separate, grid-native mechanism — see [09_Catalogue_Manager.md](09_Catalogue_Manager.md)).

## Responsibilities
- Let a user select an arbitrary set of lots (any filter/selection) and export them to Excel with chosen columns.
- Stay a general-purpose escape hatch, not a replacement for Reports' curated formats.

## Architecture
Frontend: `frontend/src/app/(app)/exports/`. Backend: `ExportController` (`api/export/excel`) — note this is on the legacy `Controllers/` surface, not a `Modules/` feature module (see [01_System_Architecture.md](01_System_Architecture.md) for the distinction and its implications for where new export logic should live).

## UI behaviour
Select lots (likely via filters similar to the Catalogue Manager) and choose which columns/fields to include, then download an `.xlsx` file.

## Business rules
Exports should reflect current data at export time — no caching of a stale export result across requests with different filters/selections.

## Dependencies
[09_Catalogue_Manager.md](09_Catalogue_Manager.md) (lot selection source), [13_Reports.md](13_Reports.md) (related but distinct fixed-format alternative).

## Future expansion
Export templates (save a column selection for reuse, analogous to Saved Filters); scheduled exports delivered via the webhook system.

## Implementation notes
`ExportController` sits on the legacy controller surface — if this module grows significantly, consider migrating it to a `Modules/Exports` feature module for consistency with newer code (see [23_Backend_Architecture.md](23_Backend_Architecture.md)).

## Open questions
- Column selection persistence (does a chosen column set survive a page reload?) — verify against current implementation.

## Best practices
Keep this module's scope to "arbitrary lot selection → Excel" — if a request is really for a fixed, repeatable format, it belongs in Reports instead ([13_Reports.md](13_Reports.md)).
