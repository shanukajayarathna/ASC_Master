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
- **Ask anything.** No agent to choose. The header shows the sale in context, the provider picker, a small voice orb, *Report canvas*, *Library* and *New chat*.
- **A small tag on each answer** ("Answered by Analytics") says which specialist wrote it; tapping it offers *Ask Auction instead* etc., which re-asks the same question with that agent.
- **Short clarifying questions.** When an analysis or report request is too open ("Compare performance"), the assistant first asks one question with tap-to-answer buttons ("What should I compare?" → Brokers / Grades / Sales over time; "Over which period?"). At most two in a row, and never for questions it can answer.
- **Results are cards in the conversation.**
  - *Charts*: Explain this chart · Pin · Excel · PDF · Save · PowerPoint · Edit in report canvas · Drill into a category (`ChartActions.tsx`). Excel, snapshot and deck use the chart's own numbers; nothing is re-queried.
  - *Lots*: a question about "lot 1204" shows lot cards under the answer with Explain valuation · Compare with grade & broker · Price ladder (top three lots of the grade by valuation — valuations, not achieved prices).
  - *Sources*: "Source · …" chips under an answer; a by-laws chip opens the cited clause.
- **The report canvas** (`ReportCanvas.tsx`) slides in beside the chat only when asked (from a chart's *Edit in report canvas*, an analysis/report answer's *Open in report canvas*, or the header button). It opens already set up from what was asked (`voiceCommand.ts` reads group, period, measure, brokers, grade). Builder · live preview (figures straight from the archive) · outputs (Excel, PDF, snapshot, PowerPoint, Schedule weekly).
- **The library** (`LibraryDrawer.tsx`) holds pinned insights (server-side, per user, max 12), scheduled weekly reports and the way to Saved Reports.
- **Voice.** A mic in the composer (transcript lands in the box for review, never auto-sent), *Read aloud* on each answer and a header toggle for reading every reply. The small orb shows listening / thinking / speaking.
- **Archive notice.** One line under the header when the archive stops before the active sale (e.g. "Archive figures run to sale 32/2026; the active sale (39/2026) is answered from its catalogue.").

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
| `AgentTag.tsx`, `agents.ts` | The answer tag and the four agent keys. |
| `ChartActions.tsx`, `chartExports.ts`, `PinnedBoard.tsx`, `pins.ts` | Chart actions, chart → table/snapshot/deck/preview, prompts, server-side pins. |
| `LotCards.tsx` | Lot cards, price ladder, lot-number detection. |
| `ReportCanvas.tsx`, `ReportBuilderPanel.tsx`, `ReportPreview.tsx`, `ReportOutputs.tsx`, `DeckCard.tsx`, `ScheduleCard.tsx`, `reportBuilder.ts`, `reportTemplates.ts`, `useReportPreview.ts`, `voiceCommand.ts` | The canvas and everything in it. |
| `LibraryDrawer.tsx`, `BylawsClauseDialog.tsx`, `AgentUsageBadge.tsx`, `archive.ts` | Library, clause viewer, admin usage chip, archive notice. |
| `VoiceOrb.tsx`, `voice.ts`, `voice-orb.css`, `workspace.css` | Orb, microphone level, speech synthesis; styles. |

## Back-end additions
- `Modules/Agents/IntentRouter.cs` — the routing and clarifying rules; `AssistantController` applies it for `agent: "auto"`.
- `Modules/Reports/CustomReportsController.cs` — `POST /api/v1/reports/custom/preview` (the archive query behind `query_data`, no model), `POST …/pptx` (deck), `GET/POST/DELETE …/specs` (scheduled reports).
- `Modules/Reports/CustomDeckGenerator.cs` — PowerPoint with **native charts** (embedded workbook, so Edit Data works) and native tables; ASC Ivory (default) / ASC Ink; ≤12 slides, ≤5 reports; stored as a downloadable `custom-deck` Saved Report and audit-logged (`report.deck.generated`).
- `Modules/Reports/CustomReportSpecsJob.cs` (+ `CustomReportSnapshot.cs`, `Models/CustomReportSpec.cs`) — scheduled-reports job `custom-report-specs` (Mondays 06:00) re-runs each enabled spec and saves a snapshot; one failing spec never stops the others.
- `Modules/Agents/SourceTracker.cs` — chat replies carry an additive `sources` list from the tools actually used (failed tools excluded); `Modules/Knowledge/CttaBylawsController.cs` serves a cited clause.
- `Modules/Observability/AiUsageScope.cs` — records the agent on each AI usage row; `GET /api/v1/admin/ai-usage/by-agent` feeds the admin badge (cost only when the model was priced).
- `Modules/Assistant/AnalyticsPinsController.cs` — `GET/POST/DELETE /api/v1/assistant/pins` (per user, max 12).
- `CustomReportTools` — `last_n_sales` without `split_by` adds the sales up into one total (`CustomReportLogic.MergeRows`); the Analytics agent has `query_data`/`make_chart`.

## Access and audit
Any signed-in user can use every agent and Reports generation (tools are read-only). Decks and scheduled specs are audit-logged (who, what, when — not the data). Usage is logged per agent; only admins see it.

## Known limits
- **Routing is rules, not understanding.** A message that doesn't match a rule goes to General (or the previous agent for a short follow-up); the tag and *Ask X instead* are the safety net. Only analysis/report requests get clarifying questions; General asks its own when it needs to.
- **Archive gap.** The archive can stop before the active sale; analytics and reports stop there and the notice says so. The Reports builder has no "13 years" period (it would run a query per sale across the whole archive).
- **Price ladder** compares valuations, not sale results.
- **Voice** works in Chromium browsers; elsewhere the mic is disabled and typing works. Voice-style commands are parsed in English only.
- **The assistant screen is English only** (the earlier hub strings in `lib/i18n.ts` and `docs/assistant-hub-i18n-review.md` are no longer used by the page; translating the new screen is a follow-up).
- **Source chips** appear on live replies and are not stored with history. The agent tag likewise.

## Testing
Frontend (Vitest + Testing Library): `universal-assistant.test.tsx` (routing calls, follow-ups, tag re-ask, clarifying buttons, chart actions, canvas, lot cards, sources, library, usage, axe-core structural accessibility), `report-canvas.test.tsx` (builder logic, canvas, deck), `voice-command.test.ts`, `assistant-logic.test.ts`. Backend (xUnit, no Mongo): `IntentRouterTests`, `CustomReport*Tests`, `CustomDeckGeneratorTests` (OpenXml schema validation and exact chart values), `SourceTrackerTests`, `AnalyticsPinsTests`. Colour contrast and layout need a real browser; a browser pass of the universal screen has **not** been done yet. Run archive queries one at a time — a cold archive query can exhaust RAM on a small machine.

To view a generated deck without PowerPoint, LibreOffice can render it (its PNG export renders only the first slide; make copies with the leading slides removed).

## Not done yet
- A real-browser pass (layout at laptop/phone widths, dark mode, contrast) and a live-archive check of the preview, deck and scheduled job.
- Translating the screen; real PowerPoint and microphone checks.
