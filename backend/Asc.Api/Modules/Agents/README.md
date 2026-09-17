# Agent Platform: registry and router, four real agents

`POST /api/v1/assistant/chat` → `AssistantController` → `AgentRouter` → `IAgentRegistry` →
`IAgent` → (the agent's own tool-calling loop against `AiGateway`) → `AgentResponse`.

**Currently implemented:**
- `GeneralAgent` (key `general`) — the original, broad assistant: catalogue/valuation Q&A,
  document/knowledge-base search, reports, deadlines. Unchanged since before this registry
  existed.
- `AuctionAgent` (key `auction`) — tea auction/sale analysis only (prices, grades, gardens,
  brokers/buyers, price rankings, sale comparison).
- `AnalyticsAgent` (key `analytics`) — market analytics over the full MSL archive (2013–
  present): quantities, proceeds, averages, broker/grade/elevation/buyer breakdowns, mark
  histories, sale comparisons, Tea Board national averages, and Excel/PDF/PPTX export.
- `ReportsAgent` (key `reports`) — finds reports that already exist (saved/automated outputs,
  via `ISavedReportsService`) and generates fresh ones on request (the same computation the
  Reports page shows), grounded with lot/KPI lookups when a report's numbers need explaining.

**Not yet implemented:** `MarketAgent`, `ResearchAgent`, `PricingAgent`, or any other agent.
Their names appear below only as forward-looking examples of what the registry pattern makes
easy to add later — none of them exist as code.

## The pieces

- **`IAgent`** (`AgentModels.cs`) — the contract every agent implements: `Key`, `Name`,
  `Description`, `Capabilities`, and `HandleAsync(AgentRequest, ct) → AgentResponse`.
  Deliberately small and provider-agnostic — no HTTP, n8n, WhatsApp, or Temporal concept
  belongs here. What an agent does inside `HandleAsync` (which tools it wires, which system
  prompt it uses) is entirely its own business; the interface only standardizes how something
  *becomes reachable*, not how it works internally.
- **`IAgentRegistry` / `AgentRegistry`** — a read-only directory over whatever `IAgent`s DI
  resolved (`Program.cs`). `TryGetByKey`, `GetAll`, `GetDefault`. No routing policy lives
  here — it never decides what an unknown or missing key *means*, it just answers "do I have
  one with this key."
- **`AgentRouter`** — the one place that turns "no key" / "a key" into a decision:
  - no key (or blank) → `IAgentRegistry.GetDefault()` — the first agent registered in
    `Program.cs`, which is (and must stay) `GeneralAgent`, so every client that predates agent
    selection keeps working unchanged.
  - a key that matches a registered agent → that agent (`"general"` → `GeneralAgent`,
    `"auction"` → `AuctionAgent`, `"analytics"` → `AnalyticsAgent`, `"reports"` →
    `ReportsAgent`).
  - a key that matches nothing → throws `UnknownAgentException`, caught by
    `AssistantController` and returned as a clean `400 Bad Request`. It never silently falls
    back to the default — an explicit but wrong request is a caller error, not something to
    paper over.
- **`GeneralAgent`** — build the system prompt, call `AiGateway.CompleteAsync` with all
  read-only tools from `AssistantToolExecutor`, return the reply. Unchanged by the other
  agents existing.
- **`AuctionAgent`** — its own auction-specific system prompt (explicit about the difference
  between ASC's own pre-auction valuation and the actual settled purchase price — the two
  most easily confused numbers in this domain), and its own tool set via
  `AuctionToolExecutor`, not `AssistantToolExecutor` directly.
- **`AnalyticsAgent`** — its own system prompt over the 13-year MSL archive, tools via
  `AnalyticsToolExecutor` (rollup-backed reads plus Excel/PDF/PPTX export). Also reachable
  from the Analysis screen's docked chat (`AnalyticsChat.tsx`), not just `/assistant`.
- **`ReportsAgent`** — its own system prompt for "what reports exist, and what do they say",
  tools via `ReportsToolExecutor`.

## Tool ownership

Each agent supplies its own `ToolDef` list to `AiGateway.CompleteAsync`. This is the real
enforcement boundary — a chat-completions API can only call a tool it was told about, so an
agent that was never given `search_knowledge_base`'s definition cannot invoke it, independent
of what the underlying executor could technically do.

- **`AssistantToolExecutor`** (`Modules/Assistant`) — the base set of tool *implementations*.
  `GeneralAgent` advertises all of them.
- **`AuctionToolExecutor`** (`Modules/Agents`) — `AuctionAgent`'s tool set: several of
  `AssistantToolExecutor`'s tools, reused by delegation (never re-implemented — same
  computation, same code) —
  `list_catalogues`, `search_lots`, `get_dashboard_stats`, `compare_sales`,
  `get_broker_performance`, `get_breakdown`, `get_top_prices`, `get_performance_insights` —
  plus one new tool, `get_top_lots` (top N lots by real settled auction price; no existing
  endpoint exposed this ranked-and-flattened across a whole sale).

  Deliberately excluded from `AuctionAgent`, and why:
  - `search_knowledge_base`, `get_upcoming_deadlines` — not auction analysis at all.
  - `get_valuation_accuracy`, `get_market_insights` — ASC-valuation-vs-actual accuracy is a
    Market Intelligence concern; that's a future `MarketAgent`'s territory, not this one's.
  - `generate_report` — stays with `GeneralAgent` and `ReportsAgent`, not `AuctionAgent`.
- **`AnalyticsToolExecutor`** (`Modules/Agents`) — `AnalyticsAgent`'s own tool set over the MSL
  archive rollups, independent of `AssistantToolExecutor` (different data source: MSL history,
  not `SaleFileStore`).
- **`ReportsToolExecutor`** (`Modules/Agents`) — `ReportsAgent`'s tool set: `list_catalogues`,
  `generate_report`, `search_lots`, `get_dashboard_stats`, `get_breakdown` reused from
  `AssistantToolExecutor`, plus two new tools over `ISavedReportsService` —
  `list_saved_reports` (most-recent-first, optionally filtered by type) and
  `get_saved_report` (one report's metadata + download link by id). Read-only: it can look up
  or generate report data, but never saves/edits/deletes a `SavedReport` — that stays a
  job-only path (`Modules/ScheduledReports`) and the Reports page's own "Save" action.

Every tool executor in this module (`AuctionToolExecutor`, `ReportsToolExecutor`, ...) rejects
any tool name outside its own advertised list at dispatch time too, as defense in depth beyond
what was advertised to the model.

### Shared tool: `get_ctta_bylaws`

The one tool every agent carries. `CttaBylawsTool` answers auction-rule questions (deposits,
prompt day, default penalties, delivery, storage charges, claims...) from
[`docs/ctta-bylaws-knowledge-base.md`](../../../../docs/ctta-bylaws-knowledge-base.md) via
`ICttaBylawsService` (`Modules/Knowledge`) — a section lookup by `##` heading, not embeddings,
so it needs no OpenAI key and always returns the Key Constants table plus the matching section
and the CCC-suspension caveat. It is attached inside each agent's `HandleAsync`
(`CttaBylawsTool.WithDefinition` / `Dispatch` / `PromptFor`), **not** added to any executor's
`Definitions` — those curated lists (and their boundary tests) are unchanged, and an agent
constructed without the tool behaves exactly as before.

## Data source

`AuctionAgent`/`ReportsAgent`/`GeneralAgent` all read the same real catalogue data through the
same existing seam — `ICatalogueSource`/`SaleFileStore` reading `data/sales/*.xlsx` — never a
new store, never invented data. `get_top_lots` and `get_top_prices` both key off
`Lot.PurchasedPrice` (the real settled auction price, populated for every broker's lots), as
distinct from `Valuation.EffectiveValue` (ASC's own pre-auction estimate) that
`get_dashboard_stats`/`get_breakdown`/`search_lots` report. `ReportsAgent`'s `generate_report`
tool (via `ReportGenerator`) reports whichever of those a report type calls for; its system
prompt, like `AuctionAgent`'s, is explicit about never conflating the two. `ReportsAgent`'s
saved-report tools read through `ISavedReportsService`, the same seam every scheduled report
job uses — never `MongoContext.SavedReports` directly. `AnalyticsAgent` is the one agent with a
different data source entirely: the MSL archive (2013–present), not `SaleFileStore`.

There is no OKLO data source in this repository. `AuctionToolExecutor`'s tools are the
extension point: an OKLO-backed source would arrive as a new `ICatalogueSource` (or a
dedicated tool reading from it) that `AuctionAgent` picks up the same way it already reads
`data/sales` — nothing about `AuctionAgent` or `AgentRouter` needs to change for that.

## Adding another agent

1. Implement `IAgent` — its own `Key`, its own system prompt, and its own tool set (a new
   `<Name>ToolExecutor`, reusing `AssistantToolExecutor`/other executors' tools by delegation
   where appropriate, same pattern `AuctionToolExecutor`/`ReportsToolExecutor` follow).
2. Register it: `builder.Services.AddScoped<IAgent, MarketAgent>();` in `Program.cs`.
3. Nothing else changes. `AgentRegistry` picks it up via `IEnumerable<IAgent>`, `AgentRouter`
   can resolve its key, and a client can request it via `ChatRequestDto.Agent`.

## What this remains deliberately without

No LLM-based intent classification ("which agent should handle this?") — routing is a plain
key lookup, nothing more. No agent-to-agent invocation. No capability-based authorization
beyond the tag list existing for future use. No WhatsApp, n8n, Temporal, notifications, or
scheduled jobs anywhere in this module — those are separate, later milestones. No
`MarketAgent`/`ResearchAgent`/`PricingAgent` — they stay unbuilt until there's a real one to
build, per the same "small, real, working" principle the rest of this codebase holds to (see
[`docs/00_Project_Vision.md`](../../../../docs/00_Project_Vision.md)).

## Rate limiting

`POST /api/v1/assistant/chat` and `POST /api/v1/assistant/compare` both carry
`[EnableRateLimiting("assistantChat")]` (`Program.cs`, partitioned by authenticated user id,
20 requests/minute) — every turn costs a real LLM call regardless of which agent answers, and
`/compare` multiplies that by the number of configured providers, so both need the same
ceiling against runaway cost, not just `/auth/login`'s brute-force concern.
