# 14 — Data Import

## Purpose
Define how new data enters the platform — both a new sale catalogue and post-sale actual prices — since correctness here determines correctness everywhere downstream.

## Scope
The `/data-import` route and the import endpoints of `CataloguesController` and `Modules/Market`. Not the ongoing browsing of already-imported data (see [09_Catalogue_Manager.md](09_Catalogue_Manager.md)).

## Responsibilities
- Import a weekly sale catalogue (.xls/.xlsx/.csv).
- Import actual post-sale prices against an existing catalogue.
- Surface import status/errors clearly.

## Architecture
Catalogue import: uploaded file → `CataloguesController`'s import endpoint → parsed server-side → written to the file store (`/data/sales`) that `SaleFileStore` warms into memory (see [01_System_Architecture.md](01_System_Architecture.md)). Actual-price import: `Modules/Market`'s import endpoint → MongoDB `actualPrices` collection.

## UI behaviour
File upload with format validation, an import-status indicator (especially relevant for actual-price import, which has a dedicated `import-status` endpoint in `Modules/Market`), and clear error surfacing on malformed files (column/type detection failures).

## Business rules
- Catalogue import is the point at which lot data becomes authoritative for a sale — once imported, lot identity (lot number, broker, grade, garden, etc.) should be treated as stable; valuations and other overlays key off it.
- Actual-price import must be matched to existing lots unambiguously (by lot key) — an unmatched actual price should be surfaced as an error/warning, not silently dropped.
- Catalogues are year-wise: 2026 sale files sit flat in `/data/sales` (the legacy namespace — their catalogue/lot ids are frozen forever and must never be recomputed) and every other year lives under `/data/sales/{year}/`, with year folded into that year's id hash from the start. `CataloguesController.Import` takes an optional `year` form field (defaulting to 2026) that decides which of those two locations a file lands in. This is a stopgap of the current file-based store — see the note in [01_System_Architecture.md](01_System_Architecture.md).

## Dependencies
[09_Catalogue_Manager.md](09_Catalogue_Manager.md), [12_Market_Intelligence.md](12_Market_Intelligence.md) (actual-price consumer), [01_System_Architecture.md](01_System_Architecture.md) (file-store model).

## Future expansion
Import validation preview (show detected columns/types before committing) if column/type detection errors turn out to be a frequent support issue; support for additional source formats if brokers deliver catalogues in other formats.

## Implementation notes
Column/type detection lives in `Services/CatalogueImportService` (xlsx/csv parsing).

## Open questions
- Is there a re-import/overwrite story if a catalogue file needs correcting after initial import? Verify against `CataloguesController` before assuming re-import is safe/supported.

## Best practices
Never let a partially-parsed catalogue silently become "the active catalogue" — a failed or partial import should be visibly distinguishable from a clean one before anyone starts valuing lots against it.
