# 27 — Future Roadmap

## Purpose
Record future capabilities deliberately, without implementing them, so ambition is captured but doesn't leak into current module docs as if it already existed.

## Scope
Product and platform capabilities not yet built. Every item here is aspirational — cross-reference against the relevant module doc (05–17) before assuming any partial implementation exists; where a module doc mentions a related future item, this document is the canonical detail, and that mention should link here rather than duplicate it.

## Responsibilities
- Hold roadmap ideas without letting them masquerade as current features anywhere else in `/docs`.
- Give each idea enough shape that a future scoping effort doesn't start from zero.

## Architecture
Not applicable — no architecture exists yet for unbuilt features. Where an idea has an obvious architectural dependency (e.g. forecasting needing a model-serving layer), that's noted inline.

## UI behaviour
Not applicable at roadmap level — will be defined per-item when scoped.

## Business rules

### Additional intelligence lenses
- **Supplier Intelligence** — performance/reliability view of tea suppliers/gardens beyond what Grade/Garden breakdowns in Analysis currently cover.
- **Customer Intelligence** — buyer-side analytics; the counterpart to today's broker-side [11_Broker_Comparison.md](11_Broker_Comparison.md). Referenced as "Buyer Intelligence" in [05_Business_Intelligence.md](05_Business_Intelligence.md).
- **Financial Intelligence** — revenue/margin analysis beyond per-lot valuation and market accuracy.
- **Risk Intelligence** — flagging anomalous lots, brokers, or pricing patterns proactively rather than only on request.
- **Relationship Intelligence** — broker/buyer relationship history and patterns across sales (requires multi-sale data model — see below).
- **Competitive Intelligence** — market-position analysis relative to other auction houses, if such data ever becomes available.
- **Inventory Intelligence** — stock/lot-flow analysis beyond a single sale's catalogue.

### Platform capabilities
- **Mobile application** — a dedicated native/PWA-enhanced mobile experience beyond the current tablet-responsive web app ([02_UI_UX_Design_System.md](02_UI_UX_Design_System.md), [10_Valuation_Centre.md](10_Valuation_Centre.md)). The existing PWA basics (manifest, minimal service worker — [01_System_Architecture.md](01_System_Architecture.md)) are a foundation, not this feature itself.
- **Offline support** — valuation entry and catalogue browsing that works with patchy sale-floor connectivity, syncing on reconnect. The current service worker deliberately does *not* cache API/HTML responses (only static assets) — real offline support is a distinct, larger effort, not an extension of the current PWA setup.
- **Real-time collaboration** — multiple users viewing/editing the same sale simultaneously with live updates (e.g. seeing a colleague's valuation appear without a manual refresh).
- **Advanced forecasting** — predicting likely actual price before a sale closes, building on [12_Market_Intelligence.md](12_Market_Intelligence.md)'s current after-the-fact estimate-vs-actual comparison. Would need a model-serving/ML layer that doesn't exist today.
- **Machine learning** — beyond forecasting specifically: anomaly detection (feeds Risk Intelligence above), automated grade/quality suggestions to assist (not replace) the taster's classification step.
- **Power BI connectors** — allow the platform's data to be consumed by external BI tooling, likely via a read-only export/API surface rather than a bespoke connector per BI tool.
- **Public API** — a documented, stable external API surface beyond the current internal `api/v1/...` modules and the API-key scheme built for n8n automation ([17_User_Management.md](17_User_Management.md)). Would need its own versioning/stability guarantees distinct from the internal API's freedom to change.

## Dependencies
Every module doc (00–24) may reference an item here; this document doesn't depend on them.

## Future expansion
This document *is* the future-expansion register — new roadmap ideas get added here first.

## Implementation notes
None of the items above have any implementation. If work begins on one, it should graduate: (1) get its own numbered module doc once real, (2) get removed or marked "in progress" here, (3) get a `NAV_ITEMS` entry only once genuinely live — never before, per [04_Navigation_Architecture.md](04_Navigation_Architecture.md)'s rule against a `"live"` status on an unfinished module.

## Open questions
- No prioritisation or sequencing exists across this list — it's a flat capture, not a ranked backlog. Should be prioritised against real business goals once [00_Project_Vision.md](00_Project_Vision.md)'s open question about formal success metrics is resolved.
- Multi-tenancy and multi-sale (cross-sale trend) data-model questions (raised in [00_Project_Vision.md](00_Project_Vision.md) and [11_Broker_Comparison.md](11_Broker_Comparison.md)) block several of the above (Relationship Intelligence, Competitive Intelligence) and should probably be resolved before those are scoped in detail.

## Best practices
Don't let a roadmap item leak into a current-state module doc as if partially built — if a module doc needs to mention one, it links here rather than describing speculative behaviour as real.
