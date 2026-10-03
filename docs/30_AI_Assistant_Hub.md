# 30 — The AI Assistant (one conversation, many specialists)

## Purpose
How the AI Assistant is presented and built: **one chat** where the user asks in plain words, while a router brings in the right specialist agent behind the scenes. Read [08_AI_Assistant.md](08_AI_Assistant.md) first for the grounding and safety model; this document covers the interface, the routing and the features built on top of it.

> **History.** An earlier design gave each agent its own workspace page behind a hub. Users had to know which agent to pick, so it was replaced (approved 2026-09-20) by a single universal chat. Old `/assistant/general|auction|analytics|reports` URLs now redirect to `/assistant`.

## Scope
Front end: `frontend/src/app/(app)/assistant/**` and `frontend/src/components/agent-hub/**` (the folder keeps its old name). Back end: routing and the report/pin/source/usage additions listed below. The agents, their tools and registration are documented in [`Modules/Agents/README.md`](../backend/Asc.Api/Modules/Agents/README.md).

## Routes
| Route | What it is |
|---|---|
| `/assistant` | The universal assistant. `?q=…` (from the dashboard's Ask ASC box) **prefills** the composer and is never sent; `?send=1&q=…` sends once (URL is cleaned so a refresh can't resend). |
| `/assistant/classic` | The original single chat page, kept for history and as a fallback. `?agent=<key>` preselects an agent there. |
| `/assistant/<agent>` | Retired: redirects to `/assistant`. |

## How it works for the user
- **Ask anything.** No agent to choose. The header shows the sale in context, the interface-language and provider pickers, a small voice orb, *Report canvas*, *Library*, *History* and *New chat*. History can be searched and reopened in the universal chat.
- **A small tag on each answer** ("Answered by Analytics") says which specialist wrote it; tapping it offers *Ask Auction instead* etc., which re-asks the same question with that agent.
- **Short clarifying questions.** When an analysis or report request is too open ("Compare performance"), the assistant first asks one question with tap-to-answer buttons ("What should I compare?" → Brokers / Grades / Sales over time; "Over which period?"). At most two in a row, and never for questions it can answer.
- **Results are cards in the conversation.**
  - *Charts*: Explain this chart · Pin · Excel · PDF · Save · PowerPoint · Edit in report canvas · Drill into a category (`ChartActions.tsx`). Excel, snapshot and deck use the chart's own numbers; nothing is re-queried.
  - *Lots*: a question about "lot 1204" shows lot cards under the answer with Explain valuation · Compare with grade & broker · Price ladder (top three lots of the grade by valuation — valuations, not achieved prices).
  - *Sources*: "Source · …" chips under an answer; a by-laws chip opens the cited clause.
- **The report canvas** (`ReportCanvas.tsx`) slides in beside the chat only when asked (from a chart's *Edit in report canvas*, an analysis/report answer's *Open in report canvas*, or the header button). It opens already set up from what was asked (`voiceCommand.ts` reads group, period, measure, brokers, grade). Builder · live preview (figures straight from the archive) · outputs (Excel, PDF, snapshot, PowerPoint, Schedule weekly).
- **The library** (`LibraryDrawer.tsx`) holds pinned insights (server-side, per user, max 12), scheduled weekly reports and the way to Saved Reports.
- **Voice.** A mic in the composer (transcript lands in the box for review, never auto-sent), *Read aloud* on each answer and a header toggle for reading every reply. The small orb shows listening / thinking / speaking.
- **Scope: not tied to one sale.** By default nothing is limited — the assistant picks the period that fits each question. The **scope** button above the composer limits archive questions to **one sale**, a **range of sales** (it may cross a year boundary, e.g. 50/2025–05/2026) or **whole years** (up to three); it is remembered per browser and sent with every message (`ChatRequestDto.Scope`). Every agent's prompt names it, a `query_data` call that named no period is given it deterministically (`ArchiveScope.ApplyToToolCall`), a chosen period also answers the router's "over which period?", and the report canvas opens on it ("Chosen scope" period). It applies to archive analysis; questions about lots in the current catalogue still follow the sale chosen in the top bar.
- **Archive notice.** A small note beside the scope button when the archive stops before the active sale (e.g. "Archive figures run to sale 32/2026; the active sale (39/2026) comes from its catalogue.").
- **Off-grade and share of a broker's own volume.** The report builder and the analysis tools can filter Off Grade / Main Grade and use the measure `share_of_own_volume_pct` (per broker): the filtered quantity as a percentage of that broker's own offered volume in the same sales — merged across sales before dividing, never a mean of percentages. This answers "is ASC's off-grade higher because it is bigger, or because more of its volume is off-grade?".

## Routing (back end)
`POST /api/v1/assistant/chat` with `agent: "auto"` runs `Modules/Agents/IntentRouter.cs` — plain keyword rules, no model, so it costs nothing, behaves the same every time and is unit-tested:
1. by-laws words → **general**; report/export/deck words → **reports**; lot/valuation words → **auction** (unless analytical); comparison/trend/archive words → **analytics**; otherwise a short follow-up stays with `previousAgent`, else **general**.
2. For an analysis/report request missing a subject or a period, it stores and returns a clarifying question (the existing `CLARIFY:` button line) instead of calling a model. A short reply to that question continues the request (judged together with the original) and may ask the next missing detail; more than two questions in a row never happen.
The response carries `agent` (the specialist that answered, or will answer once the question is answered); the client sends it back as `previousAgent`. Explicit agent keys still work (used by *Ask X instead* and the classic chat).

## Front-end map (`components/agent-hub/`)
| File | Role |
|---|---|
| `UniversalAssistant.tsx` | The page: header, conversation, drawers. |
| `ChatPanel.tsx`, `useAgentChat.ts` | Conversation card, composer, clarify buttons, sources, read-aloud, copy; conversation state, provider choice, one-time URL send, `previousAgent`. |
| `ScopeControl.tsx`, `scope.ts` | The scope button and popover (one sale · range · years), its storage, and the archive sale list. |
| `AgentTag.tsx`, `agents.ts` | The answer tag and the four agent keys. |
| `ChartActions.tsx` (Explain · Pin · Export ▾ · Edit in report canvas), `chartExports.ts`, `PinnedBoard.tsx`, `pins.ts` | Chart actions, chart → table/snapshot/deck/preview, prompts, server-side pins. |
| `LotCards.tsx` | Lot cards, price ladder, lot-number detection. |
| `ReportCanvas.tsx`, `ReportBuilderPanel.tsx`, `ReportPreview.tsx`, `ReportOutputs.tsx`, `DeckCard.tsx`, `ScheduleCard.tsx`, `reportBuilder.ts`, `reportTemplates.ts`, `useReportPreview.ts`, `voiceCommand.ts` | The canvas and everything in it. |
| `LibraryDrawer.tsx`, `HistoryDrawer.tsx`, `BylawsClauseDialog.tsx`, `AgentUsageBadge.tsx`, `archive.ts` | Library, searchable conversation history, clause viewer, admin usage chip, archive notice. |
| `VoiceOrb.tsx`, `voice.ts`, `voice-orb.css`, `workspace.css` | Orb, microphone level, speech synthesis; styles. |

## Back-end additions
- `Modules/Agents/IntentRouter.cs` — the routing and clarifying rules; `AssistantController` applies it for `agent: "auto"`.
- `Modules/Reports/CustomReportsController.cs` — `POST /api/v1/reports/custom/preview` (the archive query behind `query_data`, no model), `POST …/pptx` (deck), `GET/POST/DELETE …/specs` (scheduled reports).
- `Modules/Reports/CustomDeckGenerator.cs` — PowerPoint with **native charts** (embedded workbook, so Edit Data works) and native tables; ASC Ivory (default) / ASC Ink; ≤12 slides, ≤5 reports; stored as a downloadable `custom-deck` Saved Report and audit-logged (`report.deck.generated`).
- `Modules/Reports/CustomReportSpecsJob.cs` (+ `CustomReportSnapshot.cs`, `Models/CustomReportSpec.cs`) — scheduled-reports job `custom-report-specs` (Mondays 06:00) re-runs each enabled spec and saves a snapshot; one failing spec never stops the others.
- `Modules/Agents/SourceTracker.cs` — chat replies carry an additive `sources` list from the tools actually used (failed tools excluded); `Modules/Knowledge/CttaBylawsController.cs` serves a cited clause.
- `Modules/Observability/AiUsageScope.cs` — records the agent on each AI usage row; `GET /api/v1/admin/ai-usage/by-agent` feeds the admin badge (cost only when the model was priced).
- `Modules/Assistant/AnalyticsPinsController.cs` — `GET/POST/DELETE /api/v1/assistant/pins` (per user, max 12).
- `CustomReportTools` — `last_n_sales` without `split_by` adds the sales up into one total (`CustomReportLogic.MergeRows`); `from_year/from_sale/to_year/to_sale` select a range (one archive query per year, merged); `share_of_own_volume_pct`; the Analytics agent has `query_data`/`make_chart`.
- `Modules/Agents/ArchiveScope.cs` — the scope (validation, prompt line, deterministic injection into `query_data`).
- `Modules/Agents/SalePicker.cs` — "sale data" with no sale named is narrowed as a dialogue: which year (only years in the archive), then which sale number (only sales that exist), then the answer runs on exactly that sale (scope injected, Analytics agent). Rules, no model, so the questions cost no tokens.
  Also: "sale 32" with no year asks which year when several have it, and a lot question with no sale on screen asks which catalogue (`LotSalePicker`). Both take plain lists, so the source of the sales (files today, an API later) can change without touching them.
- `Modules/Assistant/Personalisation.cs` + `PersonalisationController.cs` — **small talk**: a bare greeting, thanks or "what can you do" is answered by the server itself (no model; stored as provider `router`), greeting the user by first name, by the time of day from the browser's `localHour`, with their own recent questions and pin count as buttons. **Preferences** (`GET/PUT /api/v1/assistant/preferences`: `myBroker`, default ASC, and `personalise`, default on); `GET /api/v1/assistant/for-you` feeds the empty screen; `DELETE /api/v1/assistant/history` deletes the user's own conversations (pins, saved reports and schedules are kept). Every agent's prompt gets a background line so "we/our/my" means the user's broker (anything in the question overrides it). Only the signed-in user's own data is read; switching personalisation off removes the name, history and broker line.

## The guided dialogue (`Modules/Agents/GuidedIntake.cs`)
For an open-ended request the assistant asks the few things it needs, as buttons built only from data that exists, then answers exactly what was chosen. Rules, not a model — the questions cost no tokens and behave the same every time.
- **Vague opener** ("tea data", "I need data", "analysis") → a menu: Check prices · Compare brokers · Best-selling grades · Tea Board averages · Look up a lot · Build a report · Ask about the by-laws.
- **What is asked, in order:** the breakdown (best-selling *what*? compare *what*?), the measure (quantity sold / average price / total value — "best selling" is ambiguous, so it asks), what to look at (all tea, one grade, one elevation, one broker — each then lists real values: the top grades of the latest sale, High/Medium/Low grown, the eight brokers with the user's own first), the period (latest sale, last 4/12 sales, this/last year, or a specific sale → year → sale numbers that exist), and for a report the format (on screen, Excel, PDF, PowerPoint). Tea Board averages ask year then month (section defaults to COMBINED).
- **Sales that exist** = the MSL archive plus the sale catalogues (the OKLO feed). A sale that has a catalogue but no archive results yet (e.g. the open sale) asks "show valuations instead?" and is answered by the Auction agent from the catalogue.
- **Never in the way:** from the second question on every question also offers *You choose for me* (the assistant picks sensible defaults and says which); every question has an *Other…* button that puts the cursor in the composer; at most 5 questions; a request that is already complete, a lot/valuation question, a by-law question, "export this", "explain this chart" and follow-ups are left to the normal routing; a brand-new longer request in the middle of a dialogue starts over.
- **One clear request for the model:** the button-tapping turns are replaced by one sentence ("<original request> — sale 31/2026; broken down by grade; measure: …"), a RESOLVED REQUEST prompt line, and deterministic filling of `query_data` (group_by, measure, grades, elevations, brokers, grade type, period) if the model omits them.
- **Answer shape** (`AgentGuidance.cs`, appended to every agent): answer first in one sentence, at most one compact table, a "Scope: period · filters · source" line, then 2–4 tappable next steps. Every agent also gets a data-source map (archive = settled results, catalogues/OKLO = lots and valuations, Tea Board = national averages, by-laws) and is told never to mix sold prices with valuations. The chat also shows *Next: Show this answer as a chart · Export this to Excel · Explain this answer in simple words* under real analytics/auction/reports answers.
- **Report canvas** understands the same words: a named sale ("sale 31 of 2026"), a year or "last year", an elevation ("high grown", "uva high"), buyers and marks; has an Elevation filter and an "Any sale, range or year" picker; groups by broker, grade, sale, origin, buyer or mark; and says plainly when a selection has no figures.

### Exact answers (no model) and the figure check
- **Direct answers** (`DirectAnswer.cs`): once the guided dialogue has chosen period, measure, breakdown and filters and the archive can answer (ranking, prices, volume, compare, top price), the server runs the archive query itself and writes the reply — one headline sentence computed from the figures, the archive's own table, a chart, and "Scope: … · Source: …". It is stored with provider `direct`, uses no tokens and never times out on a slow model. Report requests, catalogue-only sales and anything the archive can't answer still go to the agents.
- **Figure check** (`AnswerVerifier.cs`): after a model-written answer, every figure of 1,000 or more must appear in that turn's tool results (within 0.5%); years, small numbers, scope lines and chart blocks are not checked. Anything else is listed in a short "⚠ Check these figures" line above the tappable options — the answer's own words are never changed.
- **Golden dialogues** (`scripts/assistant-golden/`): scripted button-taps through the real chat endpoint, each final figure cross-checked against the archive engine's own numbers. Run with `ASC_SESSION=<jwt> node scripts/assistant-golden/run.mjs` against a backend built from this code; add a case for every wrong answer found.

## Access and audit
Any signed-in user can use every agent and Reports generation (tools are read-only). Decks and scheduled specs are audit-logged (who, what, when — not the data). Usage is logged per agent; only admins see it.

## Known limits
- **Routing is rules, not understanding.** A message that doesn't match a rule goes to General (or the previous agent for a short follow-up); the tag and *Ask X instead* are the safety net. Only analysis/report requests get clarifying questions; General asks its own when it needs to.
- **Archive gap.** The archive can stop before the active sale; analytics and reports stop there and the notice says so. The Reports builder has no "13 years" period (it would run a query per sale across the whole archive).
- **Price ladder** compares valuations, not sale results.
- **Voice** works in Chromium browsers; elsewhere the mic is disabled and typing works. Voice-style commands are parsed in English only.
- The assistant header, composer placeholder and history drawer follow the English/Sinhala/Tamil interface preference. Some report, chart and chat action labels remain English; translations should be reviewed by native speakers before expanding coverage.
- Older conversation messages predate stored source and agent metadata; new answers retain both when reopened from history.

## Testing
Frontend (Vitest + Testing Library): `universal-assistant.test.tsx` (routing calls, scope, follow-ups, tag re-ask, clarifying buttons, chart actions, canvas, lot cards, sources, library, usage, axe-core structural accessibility), `report-canvas.test.tsx` (builder logic, canvas, deck), `voice-command.test.ts`, `assistant-logic.test.ts`. Backend (xUnit, no Mongo): `IntentRouterTests`, `PersonalisationTests`, `ArchiveScopeTests`, `GuidedIntakeTests` (scripted dialogues: the sale-37 question, menu, filters, reports, Tea Board, "you choose", what must be left alone), `CustomReport*Tests`, `CustomDeckGeneratorTests` (OpenXml schema validation and exact chart values), `SourceTrackerTests`, `AnalyticsPinsTests`. Colour contrast and layout need a real browser; a browser pass of the universal screen has **not** been done yet. Run archive queries one at a time — a cold archive query can exhaust RAM on a small machine.

To view a generated deck without PowerPoint, LibreOffice can render it (its PNG export renders only the first slide; make copies with the leading slides removed).

## Not done yet
- A real-browser pass (layout at laptop/phone widths, dark mode, contrast) and a live-archive check of the preview, deck and scheduled job.
- Translating the screen; real PowerPoint and microphone checks.
