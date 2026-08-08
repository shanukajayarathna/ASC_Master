# 12 — Market Intelligence

## Purpose
Define the module that compares the platform's own valuations/estimates against actual post-sale auction prices — the platform's accuracy check on itself.

## Scope
The `/market` route and `Modules/Market`. Not broker performance (see [11_Broker_Comparison.md](11_Broker_Comparison.md)), though the two are often viewed together.

## Responsibilities
- Import actual post-sale prices.
- Compare estimate (valuation) vs. actual, at lot and aggregate level.
- Surface accuracy insights.

## Architecture
Frontend: `frontend/src/app/(app)/market/`. Backend: `Modules/Market` (`api/v1/market` — actual-price import, import-status, overview, breakdown, insights). Actual prices persist to MongoDB (`actualPrices` collection); comparison joins them against valuations and file-store lot data.

## UI behaviour
Overview + breakdown views comparing estimated vs. actual price, plus an "insights" surface (likely notable over/under-valuations). Import of actual prices is a distinct action from catalogue import — see [14_Data_Import.md](14_Data_Import.md).

## Business rules
- Actual prices are separate, later-arriving data from the original catalogue — a sale can exist and be fully valued with no actual-price data yet imported. UI must handle that "no actuals yet" state explicitly, not assume actuals always exist.
- Accuracy metrics ("forecast accuracy" in [07_Metrics_Registry.md](07_Metrics_Registry.md)) computed here should be registered there once that exists, since Reports and the AI Assistant will both want to state "how accurate were our valuations this sale."

## Dependencies
[06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md), [14_Data_Import.md](14_Data_Import.md) (actual-price import), [13_Reports.md](13_Reports.md).

## Future expansion
Formal forecasting (predicting actual price before the sale closes, not just comparing after) — see [27_Future_Roadmap.md](27_Future_Roadmap.md), "Advanced forecasting."

## Implementation notes
Backend routes: `api/v1/market/import`, `import-status`, `overview`, `breakdown`, `insights`.

## Open questions
- Is import-status polling-based or push-based today? Verify against `Modules/Market` before building a UI that assumes one or the other.

## Best practices
Treat "accuracy" as a metric like any other — define it once, in the registry, rather than computing an estimate/actual delta independently in the overview endpoint, the breakdown endpoint, and any future report.
