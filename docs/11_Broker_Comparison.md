# 11 — Broker Comparison

## Purpose
Define the module that answers "how are brokers performing against each other," a core management question for a tea auction house.

## Scope
The `/broker` route and the broker-focused endpoints of `Modules/Analytics`. Not buyer-side comparisons (not yet implemented — see [05_Business_Intelligence.md](05_Business_Intelligence.md)) and not market-price accuracy (see [12_Market_Intelligence.md](12_Market_Intelligence.md)).

## Responsibilities
- Rank brokers by performance (average valuation, market share).
- Present comparisons in a way that's directly reportable (feeds [13_Reports.md](13_Reports.md)'s broker report type).

## Architecture
Frontend: `frontend/src/app/(app)/broker/`. Backend: `Modules/Analytics`'s brokers endpoint (`api/v1/analytics/brokers`), operating over the active sale's lots + valuations, grouped by broker.

## UI behaviour
Ranking/table view of brokers with key figures (lot count, average valuation, market share). Should support the same filter set (date range, grade, garden) as the rest of the Analysis surface once the shared filtering pipeline ([06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md)) exists, rather than a bespoke filter implementation.

## Business rules
"Market share" and "average valuation" here must be the exact same calculation as any other module reporting the same figures for a broker — once [07_Metrics_Registry.md](07_Metrics_Registry.md) exists, this module should read `broker.performance` and `buyer.market_share`-style identifiers rather than computing independently.

## Dependencies
[06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md), [13_Reports.md](13_Reports.md).

## Future expansion
Trend view (broker performance over multiple sales, not just the active one) — today's implementation is scoped to a single active sale, matching the rest of the platform's single-sale-context model.

## Implementation notes
Backend route: `api/v1/analytics/brokers`.

## Open questions
- Multi-sale/trend comparison isn't supported by the current single-active-catalogue model — would require a cross-sale data model decision at the [01_System_Architecture.md](01_System_Architecture.md) level first.

## Best practices
Don't add a broker-specific metric calculation here if it's really a generic groupable metric (e.g. "average valuation by X") — register it once in the metrics registry, parameterised by group key, rather than writing a broker-only variant.
