# ASC Tea Auction Valuation & Business Intelligence Platform — Documentation

This `/docs` directory is the **single source of truth** for the ASC platform's architecture, design system, module behaviour, and engineering standards. It exists so that every future feature — whether built by a human contributor or an AI coding agent — starts from a shared, accurate understanding of the system instead of re-deriving it from scratch or guessing.

> **Ground-truth policy**: every statement in these documents is checked against the real codebase at the time of writing (August 2026). Where a document describes something aspirational (not yet built), it is explicitly labelled **Future** or placed in [27_Future_Roadmap.md](27_Future_Roadmap.md). Nothing here should be read as a claim about code that doesn't exist yet unless marked as such.

## Project purpose

ASC is an internal valuation and business-intelligence platform for a tea auction house. It replaces manual, spreadsheet-driven cataloguing and valuation with a browser-based workflow: import a weekly sale catalogue, value and classify each lot, analyse the sale across brokers/grades/gardens/markets, generate reports, and (via an AI assistant and a document knowledge base) let staff ask questions grounded in that data.

## Architecture at a glance

- **Frontend**: Next.js 16 (App Router) + React 19 + TypeScript, Material UI 9 + Emotion, Tailwind CSS 4, AG Grid Enterprise 36. Lives in [`/frontend`](../frontend).
- **Backend**: ASP.NET Core (.NET 9) Web API. Lives in [`/backend/Asc.Api`](../backend/Asc.Api). JWT auth plus a separate API-key scheme for external tools (n8n-style automation).
- **Data**: Two-tier. Catalogue/lot data is **file-based** (weekly sale Excel/CSV files under `/data/sales`, read by `SaleFileStore`). User-entered state — valuations, users, reports, conversations, documents, API keys, webhooks — lives in **MongoDB** (`asc_tea` database).
- **AI**: OpenAI (`gpt-5.1`)-backed chat assistant with read-only tool-calling grounded in catalogue data, plus an embeddings-backed document knowledge base.
- **Legacy**: A pre-existing vanilla HTML/CSS/JS build at the repo root (`index.html`, `css/`, `js/`) is kept untouched as a working reference. It is not part of the current architecture — see [22_Frontend_Architecture.md](22_Frontend_Architecture.md).

Full diagrams: [01_System_Architecture.md](01_System_Architecture.md).

## Folder structure

```
/docs
├── README.md                      this file
├── 00_Project_Vision.md
├── 01_System_Architecture.md
├── 02_UI_UX_Design_System.md
├── 03_Dashboard_Experience.md
├── 04_Navigation_Architecture.md
├── 05_Business_Intelligence.md
├── 06_Shared_Analytics_Engine.md
├── 07_Metrics_Registry.md
├── 08_AI_Assistant.md
├── 09_Catalogue_Manager.md
├── 10_Valuation_Centre.md
├── 11_Broker_Comparison.md
├── 12_Market_Intelligence.md
├── 13_Reports.md
├── 14_Data_Import.md
├── 15_Knowledge_Base.md
├── 16_Exports.md
├── 17_User_Management.md
├── 18_Security.md
├── 19_Performance.md
├── 20_Component_Library.md
├── 21_Design_Tokens.md
├── 22_Frontend_Architecture.md
├── 23_Backend_Architecture.md
├── 24_API_Guidelines.md
├── 25_Coding_Standards.md
├── 26_Testing_Strategy.md
├── 27_Future_Roadmap.md
└── assets/
    ├── wireframes/
    ├── ui/
    ├── icons/
    └── branding/
```

`assets/` subfolders are currently empty placeholders — drop wireframes, UI screenshots, exported icon sets, and brand collateral in as they're produced, and reference them from the relevant module doc rather than duplicating images across docs.

## Design philosophy

Dashboard-first, sidebar-free. Navigation happens through a tile-grid launchpad and a `Ctrl/Cmd+K` command palette, not a persistent side rail — see [04_Navigation_Architecture.md](04_Navigation_Architecture.md). Visual language is warm and editorial (ink/paper neutrals plus liquor/brass/sage accent colours evoking tea itself) rather than generic SaaS blue — see [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md) and [21_Design_Tokens.md](21_Design_Tokens.md). Light and dark themes are both first-class.

## Coding philosophy

Small, direct, boundary-scoped code over premature abstraction. No speculative feature flags, no backwards-compatibility shims for code that can just be changed, no error handling for cases that can't occur. Shared logic (analytics calculations, metric definitions) is centralised so every consumer — dashboard, report, AI assistant, export — computes the same number the same way. See [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md), and [25_Coding_Standards.md](25_Coding_Standards.md).

## How future contributors should use these specifications

1. **Before implementing a feature**, read the module doc(s) it touches (09–17) plus any of the cross-cutting docs it depends on (design system, analytics engine, metrics registry, security).
2. **If the feature isn't covered**, or changes behaviour described here, update the relevant doc *first* — in the same change — so the doc and the code never drift apart. A stale doc is worse than no doc; the root `README.md`'s "what's wired" section going stale is the cautionary example that motivated this restructuring.
3. **If a new module is added**, add a new numbered doc following the template used by 09–17, and link it from [05_Business_Intelligence.md](05_Business_Intelligence.md) or [04_Navigation_Architecture.md](04_Navigation_Architecture.md) as appropriate, plus [MEMORY]-style cross-references from any doc that now depends on it.
4. **Do not duplicate information.** If two docs would need the same explanation, put it in the more fundamental one and link to it.

## Document template

Every module/feature document (03, 05, 08–19) follows the same section order: Purpose, Scope, Responsibilities, Architecture, UI Behaviour, Business Rules, Dependencies, Future Expansion, Implementation Notes, Open Questions, Best Practices. This consistency is intentional — it makes the set skimmable and makes gaps (an empty "Open Questions" vs. one that's been ignored for months) visible at a glance.

## Development workflow

See the root [`README.md`](../README.md) for concrete run instructions (MongoDB, JWT/OpenAI secrets, `npm run dev`). This `/docs` set is the architecture reference; the root README is the "how do I run this on my machine" quickstart. Keep the two in sync where they overlap (tech stack, folder layout) but don't merge them — different audiences, different lifespans.
