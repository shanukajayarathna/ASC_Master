# Agent Platform: registry and router, two real agents

`POST /api/v1/assistant/chat` → `AssistantController` → `AgentRouter` → `IAgentRegistry` →
`IAgent` → (the agent's own tool-calling loop against `AiGateway`) → `AgentResponse`.

**Currently implemented:**
- `GeneralAgent` (key `general`) — the original, broad assistant: catalogue/valuation Q&A,
  document/knowledge-base search, reports, deadlines. Unchanged since before this registry
  existed.
- `AuctionAgent` (key `auction`) — the first business-specific agent: tea auction/sale
  analysis only (prices, grades, gardens, brokers/buyers, price rankings, sale comparison).

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
    `"auction"` → `AuctionAgent`).
  - a key that matches nothing → throws `UnknownAgentException`, caught by
    `AssistantController` and returned as a clean `400 Bad Request`. It never silently falls
    back to the default — an explicit but wrong request is a caller error, not something to
    paper over.
- **`GeneralAgent`** — build the system prompt, call `AiGateway.CompleteAsync` with all 13
  read-only tools from `AssistantToolExecutor`, return the reply. Unchanged by `AuctionAgent`
  existing.
- **`AuctionAgent`** — its own auction-specific system prompt (explicit about the difference
  between ASC's own pre-auction valuation and the actual settled purchase price — the two
  most easily confused numbers in this domain), and its own tool set via
  `AuctionToolExecutor`, not `AssistantToolExecutor` directly.

## Tool ownership

Each agent supplies its own `ToolDef` list to `AiGateway.CompleteAsync`. This is the real
enforcement boundary — a chat-completions API can only call a tool it was told about, so an
agent that was never given `search_knowledge_base`'s definition cannot invoke it, independent
of what the underlying executor could technically do.

- **`AssistantToolExecutor`** (`Modules/Assistant`) — all 13 tool *implementations*.
  `GeneralAgent` advertises all of them.
- **`AuctionToolExecutor`** (`Modules/Agents`) — `AuctionAgent`'s tool set: 8 of
  `AssistantToolExecutor`'s tools, reused by delegation (never re-implemented — same
  computation, same code) —
  `list_catalogues`, `search_lots`, `get_dashboard_stats`, `compare_sales`,
  `get_broker_performance`, `get_breakdown`, `get_top_prices`, `get_performance_insights` —
  plus one new tool, `get_top_lots` (top N lots by real settled auction price; no existing
  endpoint exposed this ranked-and-flattened across a whole sale). `AuctionToolExecutor`
  rejects any other tool name at dispatch time too, as defense in depth beyond the advertised
  list.

  Deliberately excluded from `AuctionAgent`, and why:
  - `search_knowledge_base`, `get_upcoming_deadlines` — not auction analysis at all.
  - `get_valuation_accuracy`, `get_market_insights` — ASC-valuation-vs-actual accuracy is a
    Market Intelligence concern; that's a future `MarketAgent`'s territory, not this one's.
  - `generate_report` — `get_dashboard_stats`/`get_breakdown`/`get_top_prices` already cover a
    meaningful first `AuctionAgent`; adding the full report generator wasn't necessary for
    this milestone and stays with `GeneralAgent` only.

## Data source

Both agents read the same real catalogue data through the same existing seam —
`ICatalogueSource`/`SaleFileStore` reading `data/sales/*.xlsx` — never a new store, never
invented data. `AuctionAgent`'s `get_top_lots` and the reused `get_top_prices` both key off
`Lot.PurchasedPrice` (the real settled auction price, populated for every broker's lots), as
distinct from `Valuation.EffectiveValue` (ASC's own pre-auction estimate) that
`get_dashboard_stats`/`get_breakdown`/`search_lots` report. `AuctionAgent`'s system prompt is
explicit about never conflating the two.

There is no OKLO data source in this repository. `AuctionToolExecutor`'s tools are the
extension point: an OKLO-backed source would arrive as a new `ICatalogueSource` (or a
dedicated tool reading from it) that `AuctionAgent` picks up the same way it already reads
`data/sales` — nothing about `AuctionAgent` or `AgentRouter` needs to change for that.

## Adding a third agent

1. Implement `IAgent` — its own `Key`, its own system prompt, and its own tool set (a new
   `<Name>ToolExecutor`, reusing `AssistantToolExecutor`/`AuctionToolExecutor` tools by
   delegation where appropriate, same pattern `AuctionToolExecutor` follows).
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
