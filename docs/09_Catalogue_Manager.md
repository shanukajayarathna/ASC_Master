# 09 — Catalogue Manager

## Purpose
Define the Catalogue Manager as the platform's system of record for browsing a sale's lots, since almost every other module reads lot data that ultimately flows through this one.

## Scope
The `/catalogue` route, `CataloguesController`/`LotsController`, and the AG Grid-based grid experience. Not valuation entry itself (see [10_Valuation_Centre.md](10_Valuation_Centre.md)) or import mechanics (see [14_Data_Import.md](14_Data_Import.md)).

## Responsibilities
- Present every lot in the active sale in a fast, filterable, sortable grid.
- Own the "active catalogue" concept that scopes most of the rest of the app.
- Provide selection + bulk-action entry points (bulk-classify, bulk-clear-notes) consumed by the Valuation Centre.

## Architecture
`frontend/src/components/catalogue/` (`CatalogueGrid` — AG Grid Enterprise, `ValuationDrawer`, grid theme setup) driven by `frontend/src/context/CatalogueContext` (active catalogue + list). Backend: `CataloguesController` (`api/catalogues` — list/get/delete/import/previous-grade-stats) and `LotsController` (`api` — lots list, bulk-classify, bulk-clear-notes; valuation PATCH lives here too but is covered in [10_Valuation_Centre.md](10_Valuation_Centre.md)). Lot data itself is read from the file store (`SaleFileStore`), not Mongo — see [01_System_Architecture.md](01_System_Architecture.md).

## UI behaviour
AG Grid Enterprise grid with the Enterprise column/filter side panel, row selection, and built-in CSV/Excel export. Currently loads up to 5,000 rows client-side per catalogue (matches the legacy app's approach) — no server-side row model yet. Grid theme follows the app's light/dark tokens automatically via AG Grid v36's Theming API reading the same CSS custom properties as the rest of the app ([21_Design_Tokens.md](21_Design_Tokens.md)).

## Business rules
- The "active catalogue" (`CatalogueContext`) scopes what most other modules (Dashboard, Analysis, Broker Comparison, Market Intelligence, Valuation Centre) operate on. Switching it should be an explicit, visible user action, not implicit.
- Bulk operations (classify, clear notes) act on the current grid selection and call the API directly — they are not client-side-only mutations, so they must handle partial failure (some lots updated, some not) visibly rather than silently.
- Deleting a catalogue is destructive and should require explicit confirmation in the UI.

## Dependencies
[10_Valuation_Centre.md](10_Valuation_Centre.md), [14_Data_Import.md](14_Data_Import.md), [01_System_Architecture.md](01_System_Architecture.md) (file-based lot storage model), [20_Component_Library.md](20_Component_Library.md) (grid as a reusable pattern).

## Future expansion
Server-side row model for catalogues beyond ~5,000 rows; a real AG Grid Enterprise licence (currently unset — grid shows a watermark/console warning in its absence, per root README); saved column layouts per user.

## Implementation notes
No AG Grid Enterprise licence key is currently configured (`NEXT_PUBLIC_AG_GRID_LICENSE_KEY` unset in `frontend/.env.local`) — functional in development, watermarked without a paid key.

## Open questions
- At what row count does the client-side model become a real problem in production catalogues? Not measured yet.

## Best practices
Any new lot-level bulk action should follow the existing bulk-classify/bulk-clear-notes pattern (selection → single batch API call → visible per-row success/failure), not a loop of individual per-lot requests from the client.
