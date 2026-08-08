# 10 — Valuation Centre

## Purpose
Define the core value-adding workflow of the platform — turning an imported lot into a valued, classified one — since this is the single most frequent task the platform exists to speed up (see [00_Project_Vision.md](00_Project_Vision.md)).

## Scope
The `/valuation` route (list view and tablet-friendly focus mode), `ValuationDrawer`, and the valuation-write side of `LotsController`. Not lot browsing/filtering itself (see [09_Catalogue_Manager.md](09_Catalogue_Manager.md)) or valuation-derived analytics (see [05_Business_Intelligence.md](05_Business_Intelligence.md)).

## Responsibilities
- Let a taster/valuer record a value (range or single figure), classification (Best/Below Best/Poor), and remarks for a lot.
- Support both a desktop list workflow and a tablet-optimised focus mode for sale-floor use.
- Persist valuations reliably and make them immediately visible to every other module.

## Architecture
Frontend: `frontend/src/components/valuation/`, `ValuationDrawer` (also used from the Catalogue Manager grid). Backend: `LotsController`'s `PATCH /api/lots/{id}/valuation`. Valuations persist to MongoDB (`valuations` collection), joined back onto file-store lot data by lot key wherever lots are displayed — see [01_System_Architecture.md](01_System_Architecture.md).

## UI behaviour
Two modes: a list view (open a ticket from the grid, value, save, move to next) and a "focus mode" designed for tablet use at the sale floor — larger touch targets, minimal chrome, one-lot-at-a-time flow. Fields: value (From/To range or single value), classification, remarks. Per-lot photos and voice notes are also supported (`LotMediaController`, disk-backed under `/data/media`).

## Business rules
- A valuation write must not silently fail — the UI must reflect save success/failure per lot.
- **Optimistic concurrency, not last-write-wins.** `PATCH /api/lots/{id}/valuation` requires the client to echo back the `UpdatedAt` it last saw for that lot's valuation (`ValuationUpdateDto.ExpectedUpdatedAt`, `null` if never valued). If that no longer matches what's actually stored — i.e. someone else saved a change in between — the API rejects the write with `409 Conflict` and a `ValuationConflictDto` carrying the lot as it currently stands, instead of overwriting the other person's edit. The UI must handle this response by showing the user the conflicting state (not just a generic error), since two tasters could plausibly open the same lot concurrently on the sale floor. This is the concrete mechanism behind "must not silently fail" above.
- Classification values are constrained to the fixed set (Best / Below Best / Poor) — this is a controlled vocabulary, not free text, so downstream analytics (Business Intelligence, Reports) can rely on it.
- "Completion" (a metric used across the Dashboard and Reports) means every lot in the active catalogue has a saved valuation — this definition must live in [07_Metrics_Registry.md](07_Metrics_Registry.md) once that exists, not be redefined per consumer.

## Dependencies
[09_Catalogue_Manager.md](09_Catalogue_Manager.md) (lot source), [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md) / [07_Metrics_Registry.md](07_Metrics_Registry.md) (completion and average-valuation metrics), [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) (tablet responsiveness requirement).

## Future expansion
Voice-to-text for remarks (voice notes are currently captured as audio, not transcribed); offline valuation entry with sync-on-reconnect for patchy sale-floor connectivity (see [27_Future_Roadmap.md](27_Future_Roadmap.md), "Offline support").

## Implementation notes
`PATCH /api/lots/{id}/valuation` is the single write path — both list view and focus mode should call the same endpoint rather than diverging.

## Open questions
- Should partially-entered valuations (value saved, classification pending) count toward "completion," or only fully-entered ones? Not explicitly decided in code today — worth confirming against actual `LotsController`/model behaviour before relying on it in a metric definition.

## Best practices
Always test valuation entry at tablet width before shipping a change here — this is the one screen explicitly designed for sale-floor tablet use, and it's the easiest one to regress by assuming desktop-only interaction.
