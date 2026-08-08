# 13 — Reports

## Purpose
Define the module that packages analytics into fixed, shareable report formats — the bridge between ad hoc analysis and something a manager can hand to someone else.

## Scope
The `/reports` route, `/saved-reports`, and `Modules/Reports`. Not ad hoc lot-selection Excel export (see [16_Exports.md](16_Exports.md), which is a distinct, more flexible mechanism).

## Responsibilities
- Offer a fixed set of report types (executive, broker, grade, valuation summaries, per root README's mention of "7 report types").
- Generate reports to Excel.
- Save/reopen previously generated reports.

## Architecture
Frontend: `frontend/src/app/(app)/reports/` and `frontend/src/app/(app)/saved-reports/`. Backend: `Modules/Reports` (`api/v1/reports` — report types, Excel export, saved reports). Saved reports persist to MongoDB (`savedReports`).

## UI behaviour
Choose a report type → optionally filter/scope it → generate → view and/or export to Excel → optionally save for later (surfaces under Saved Reports, a Library-section module — see [04_Navigation_Architecture.md](04_Navigation_Architecture.md)).

## Business rules
- Every figure in a generated report must match the equivalent figure shown live elsewhere in the app (dashboard, Analysis, Broker/Market Intelligence) for the same filter set — this is the practical test of the "one number, one source" principle. Once [07_Metrics_Registry.md](07_Metrics_Registry.md) exists, reports should be built by requesting registry metrics, not by independent calculation.
- A saved report should capture enough context (filter set, generation timestamp, sale/catalogue reference) to be meaningfully reopened later, even after the underlying data has changed.

## Dependencies
[06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md), [05_Business_Intelligence.md](05_Business_Intelligence.md), [16_Exports.md](16_Exports.md) (related but distinct export mechanism).

## Future expansion
Scheduled/recurring report generation; report delivery via the outbound webhook system ([17_User_Management.md](17_User_Management.md) covers API keys/webhooks ownership) so a report can trigger an n8n workflow automatically.

## Implementation notes
Backend routes: `api/v1/reports/*`. 7 report types shipped per commit `bf81a34` — enumerate the exact list from `Modules/Reports` before documenting them individually here in more detail.

## Open questions
- Exact list and definition of the 7 report types isn't captured in this document yet — should be filled in from `Modules/Reports`'s actual type enum.

## Best practices
When adding a new report type, check whether it's genuinely new or a different filter/grouping of an existing type before creating a new type — report-type sprawl duplicates the same underlying metrics under different names.
