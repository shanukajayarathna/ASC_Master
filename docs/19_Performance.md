# 19 — Performance

## Purpose
Record known performance characteristics and seams so scaling decisions are made deliberately rather than discovered under production load.

## Scope
Frontend rendering/data-loading performance and backend aggregation/query performance. Not infrastructure/deployment performance (not yet documented anywhere — no deployment topology exists in this repo today).

## Responsibilities
- Track the platform's known scaling limits.
- Set expectations for what "fast enough" means on tablet devices at the sale floor.

## Architecture
No dedicated caching layer beyond `SaleFileStore`'s startup warm of sale files into memory (see [01_System_Architecture.md](01_System_Architecture.md)). AG Grid Enterprise loads catalogue data client-side, no server-side row model yet.

## UI behaviour
The Valuation Centre's tablet focus mode ([10_Valuation_Centre.md](10_Valuation_Centre.md)) must remain responsive on real tablet hardware at the sale floor, not just on a developer's desktop — this is a functional requirement, not a nice-to-have, given the platform's stated primary workflow.

## Business rules
Not applicable in the traditional sense — this document is technical, but its constraints (catalogue size limits, tablet responsiveness) do shape which UI patterns are acceptable.

## Dependencies
[01_System_Architecture.md](01_System_Architecture.md) (file-store warm/caching model), [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md) (aggregation performance), [09_Catalogue_Manager.md](09_Catalogue_Manager.md) (grid row-count ceiling).

## Future expansion
- **AG Grid server-side row model** — needed once catalogues regularly exceed ~5,000 rows (current client-side ceiling, matching the legacy app's approach).
- **Per-metric result caching** in the shared analytics engine ([06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md)) once Reports, the AI Assistant, and Exports all request the same aggregates repeatedly per sale.
- **Background/async report generation** if report types grow expensive enough that synchronous request/response stops being acceptable.

## Implementation notes
No load testing or performance benchmarking exists in the repo today (see [26_Testing_Strategy.md](26_Testing_Strategy.md)'s equivalent gap). Known limits are qualitative (documented in the root README and carried into [01_System_Architecture.md](01_System_Architecture.md)), not measured.

## Open questions
- What's the real, current catalogue size distribution in production use? Without that, the "5,000 row ceiling" and "cache the aggregations" recommendations are informed guesses, not measured priorities.

## Best practices
- Before adding a new expensive aggregation, check whether it can be served by an existing cached metric ([07_Metrics_Registry.md](07_Metrics_Registry.md)) rather than a fresh query.
- Test new UI on tablet-class hardware, not just a resized desktop browser window — CPU and touch-latency characteristics differ meaningfully.
