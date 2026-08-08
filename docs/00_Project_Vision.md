# 00 — Project Vision

## Purpose
Define why the ASC platform exists, who it serves, and what "done" looks like for it, so every module decision (05–17) can be checked against a shared strategic intent rather than decided ad hoc.

## Scope
Product vision and business framing only. No technical design — see [01_System_Architecture.md](01_System_Architecture.md) for that.

## Responsibilities
- Articulate the platform's reason for existing and its target users.
- Describe the primary end-to-end workflows the platform must support well.
- Set the principles that should resolve ambiguous product decisions.

## Architecture
Not applicable to this document.

## UI behaviour
Not applicable to this document — see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) and [03_Dashboard_Experience.md](03_Dashboard_Experience.md).

## Business rules

### Platform vision
Replace the spreadsheet- and paper-driven workflow of a tea auction house's cataloguing and valuation process with a single, fast, dashboard-first web application — one that a taster or valuer can use on the sale floor, a broker-relations manager can use to compare performance, and a manager can use to answer "how did this sale go" without waiting on a manually assembled report.

### Business goals
- Cut the time between "catalogue arrives" and "every lot is valued and classified" by digitising the valuation step (see [10_Valuation_Centre.md](10_Valuation_Centre.md)).
- Make sale-level and cross-sale analysis (broker performance, market accuracy, grade/garden trends) available instantly instead of requiring manual aggregation — see [05_Business_Intelligence.md](05_Business_Intelligence.md).
- Reduce reliance on any one person's institutional memory by grounding an AI assistant and a searchable knowledge base in the platform's own data — see [08_AI_Assistant.md](08_AI_Assistant.md) and [15_Knowledge_Base.md](15_Knowledge_Base.md).
- Keep the system operable by a small team: file-based catalogue ingestion needs no database migration step, and MongoDB is deliberately chosen for low local-setup friction (see [01_System_Architecture.md](01_System_Architecture.md)).

### Target users
- **Tasters / valuers** — value and classify lots quickly, ideally on a tablet at the sale floor (see the Valuation Centre's "focus mode").
- **Brokers-relations / analysis staff** — compare broker and market performance, build reports.
- **Managers / admins** — oversee users, roles, API keys, and outbound automation (n8n-style webhooks); consume executive dashboards and reports.
- **External automation** (via API keys) — systems like n8n reading platform data through the API-key auth scheme, not the interactive UI.

### Primary workflows
1. **Import** a weekly sale catalogue (Excel/CSV) → lots appear in the Catalogue Manager.
2. **Value** each lot (range or single value, classification, remarks) in the Valuation Centre, individually or in bulk.
3. **Analyse** the sale — dashboard KPIs, Analysis breakdowns, Broker Comparison, Market Intelligence (estimate vs. actual price).
4. **Report** — generate and save report types, export to Excel.
5. **Ask** — use the AI Assistant or Knowledge Base to answer questions grounded in the current sale's data or uploaded documents.

### Long-term roadmap
See [27_Future_Roadmap.md](27_Future_Roadmap.md) for the full list (Supplier/Customer/Financial/Risk Intelligence, mobile app, offline support, real-time collaboration, advanced forecasting, ML, Power BI connectors, public API). This vision document intentionally does not restate that list — it stays the authoritative detail for roadmap items.

### Core principles
- **One number, one source.** A metric (e.g. average valuation) is computed once, in the shared analytics engine, and every surface — dashboard, report, AI answer, export — reads it from there. See [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md) and [07_Metrics_Registry.md](07_Metrics_Registry.md).
- **Dashboard-first, not menu-first.** Getting to a module should take one click from the launchpad or one keystroke sequence via the command palette — never a nested menu hunt. See [04_Navigation_Architecture.md](04_Navigation_Architecture.md).
- **Grounded AI, not generative guessing.** The AI Assistant answers from the platform's actual data via tool-calling, not from unconstrained generation.
- **Small, real, working.** Ship a module as a genuinely working feature (as the current build does — every nav item is `status: "live"`, not a placeholder) rather than a stub described as "coming soon."

## Dependencies
This document sits above all others; it has no dependencies but is referenced by all module docs (05–17) as the justification for why the module exists.

## Future expansion
See [27_Future_Roadmap.md](27_Future_Roadmap.md).

## Implementation notes
Not applicable — this is a product framing document.

## Open questions
- Formal success metrics (e.g. target time-to-value-a-sale, adoption rate) are not yet defined anywhere in the codebase or docs. Should be captured here once the business defines them.
- Multi-tenancy (one deployment per auction house vs. shared platform) is undecided — current architecture assumes a single organisation.

## Best practices
When a product decision is ambiguous, resolve it in favour of the workflow that gets a taster from "catalogue arrives" to "sale fully valued and analysed" fastest, without breaking the "one number, one source" principle.
