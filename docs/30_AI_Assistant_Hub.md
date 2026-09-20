# 30 — AI Assistant Hub and Agent Workspaces

## Purpose
How the AI Assistant is organised for users (a hub and four per-agent workspaces), how each workspace is built, and what it does and does not do today. Read [08_AI_Assistant.md](08_AI_Assistant.md) first for the grounding and safety model; this document covers the front-end structure and the features built on top of it.

## Scope
Front end: `frontend/src/app/(app)/assistant/**` and `frontend/src/components/agent-hub/**`. Back end: the report, pin, source and usage additions listed under [Back-end additions](#back-end-additions). The agents themselves, their tools and routing are documented in [`Modules/Agents/README.md`](../backend/Asc.Api/Modules/Agents/README.md).

## Routes

| Route | What it is |
|---|---|
| `/assistant` | The **hub**: one ask box (General) and a compact row of links to the specialists. A `?q=` (from the dashboard's Ask ASC box) forwards to the classic chat, prefilled and not sent. |
| `/assistant/general`, `/auction`, `/analytics`, `/reports` | The four **workspaces**. Unknown keys 404 (`dynamicParams = false`). |
| `/assistant/classic` | The original single chat page, kept for history, agent picking and as a fallback. `?agent=<key>` preselects an agent; `?agent=general&send=1&q=…` sends once, after providers and the active sale have loaded. |

The hub's ask box sends to `/assistant/general?send=1&q=…`; the workspace sends the question once (exactly one request, and the URL is cleaned so a refresh cannot resend it).

## Design decisions
- **One obvious action first.** The hub is an ask box, not four tiles to choose between; General handles anything, and a specialist link is for someone who already knows the job. General also suggests a specialist after a matching question (keyword rules in `handoff.ts`; the backend router only resolves an agent key and does not classify).
- **Same system, not a separate app.** Everything uses the app's own tokens, `PageHeader`, cards and font pairing. The hub's only bespoke element is the animated art in the ask box.
- **Numbers never come from a model where the system can supply them.** The Reports preview, deck and Excel come from an archive query; charts and tables in chat are pasted from tool results via placeholders (see 08 and the Reports Agent notes).
- **Read-only.** No workspace changes lots, valuations or reports (Reports can *save* snapshots, decks and schedules of its own output).

## Shared pieces (`components/agent-hub/`)

| File | Role |
|---|---|
| `agents.ts` | The four agent keys (match the backend `IAgent.Key`), names, and `askHref`. |
| `AgentHub.tsx`, `AskHero.tsx`, `SpecialistLink.tsx`, `visuals.tsx`, `agent-hub.css` | The hub page. |
| `WorkspaceShell.tsx` | Header with back link, status orb, sale chip, admin usage badge, agent switcher, and the archive notice. |
| `useAgentChat.ts` | One agent's conversation: provider choice, active sale, one-time send of a hub question, slow/stop handling. |
| `ChatPanel.tsx` | Conversation card + composer shared by General, Auction and Analytics: answers with tables/charts, source chips, read-aloud, copy, suggested prompts, hand-off slot. |
| `VoiceOrb.tsx`, `voice.ts`, `voice-orb.css` | The orb, microphone level (Web Audio), speech synthesis, and hold-to-speak. |
| `archive.ts` | Latest archived sale (from the cheap per-sale rollups) and the "archive stops at sale N" notice. |
| `BylawsClauseDialog.tsx`, `AgentUsageBadge.tsx` | Clause viewer for by-law source chips; admin-only usage chip. |
| `workspace.css` | Workspace layouts and accents. |

## Workspaces

### General (`GeneralWorkspace.tsx`)
Chat on the left; a voice panel with the Voice Orb on the right. Speech in uses the browser's recognition (transcript lands in the box for review, never auto-sent). Speech out uses browser speech synthesis ("Read aloud" per answer, optional "Read replies aloud"). If no voice for the chosen language is installed the panel says so.

### Auction (`AuctionWorkspace.tsx`, `LotLookup.tsx`)
Search the active sale's lots (lot number, garden, mark, invoice); a lot card offers **Explain valuation**, **Compare with grade & broker** (both send a precise question to the Auction agent) and **Price ladder** (top three lots of the grade by valuation — valuations, not achieved prices, because the archive has no result for the active sale yet).

### Analytics (`AnalyticsWorkspace.tsx`, `CompareBuilder.tsx`, `PinnedBoard.tsx`, `pins.ts`)
Ask a question or use the **Compare** builder (brokers/grades/sales × measure × period). Every chart offers **Explain this chart** (sends the chart's own figures), **Pin**, and **Drill into** its categories. The **pinned-insights board** is stored per user on the server (max 12). The Analytics agent has `query_data` and `make_chart` (the same chart tools as Reports).

### Reports (`ReportsWorkspace.tsx`, `ReportBuilderPanel.tsx`, `ReportPreview.tsx`, `ReportOutputs.tsx`, `DeckCard.tsx`, `ScheduleCard.tsx`, `VoiceBuilder.tsx`)
Three panes:
- **Builder** — describe it (goes to the Reports agent), start from a template, group by broker/grade/sale/origin, broker chips in portal colours, grade filter, measure, period (last 4, last 12, year, latest sale), visual.
- **Live preview** — a paper page whose figures come from `POST /api/v1/reports/custom/preview` (the archive query behind `query_data`, no model). "Last N sales" adds the sales up into one total (quantity-weighted average, exact across sale boundaries). Placeholders are clearly labelled while loading.
- **Output** — Excel (built in the browser), PDF (saves a snapshot and opens its print page), Save snapshot, **PowerPoint** (below), **Schedule weekly**, and the **Voice builder**.

**PowerPoint** — `POST /api/v1/reports/custom/pptx` builds a deck with native charts (embedded workbook, so Edit Data works) and native tables, in **ASC Ivory** (default) or **ASC Ink**, at most 12 slides and 5 reports. The file is stored, listed under Saved Reports as a downloadable `custom-deck`, and audit-logged (`report.deck.generated`). Implementation: `Modules/Reports/CustomDeckGenerator.cs` (reuses the OpenXml skeleton from `PresentationGenerator`).

**Schedule weekly** — saves the builder's query (max 10 per user). The scheduled-reports job `custom-report-specs` (Mondays 06:00) re-runs every enabled spec and saves a snapshot to Saved Reports; one failing spec never stops the others. Visible in the Admin Panel's Automated Reports list.

**Voice builder** — hold to speak, review the words, then **Apply to builder**. Plain keyword rules (`voiceCommand.ts`; English only) set the builder controls; the words themselves are never data. Example: "Compare brokers for BOPF over the last 12 sales, then make a deck."

## Back-end additions
- `Modules/Reports/CustomReportsController.cs` — preview, deck, scheduled specs (`/api/v1/reports/custom/{preview,pptx,specs}`).
- `Modules/Reports/CustomReportSpecsJob.cs`, `CustomReportSnapshot.cs`, `Models/CustomReportSpec.cs` — scheduling and snapshot format.
- `Modules/Agents/SourceTracker.cs` — chat replies carry an additive `sources` list built from the tools actually used (failed tools excluded): by-laws, archive, catalogue, saved reports, generated files. A by-laws chip opens the cited clause via `GET /api/v1/knowledge/ctta-bylaws/section?title=` (`Modules/Knowledge/CttaBylawsController.cs`).
- `Modules/Observability/AiUsageScope.cs` — records the agent on each AI usage row; `GET /api/v1/admin/ai-usage/by-agent` feeds the admin badge (cost only shown when the model was priced).
- `Modules/Assistant/AnalyticsPinsController.cs` — `GET/POST/DELETE /api/v1/assistant/pins` (per user, max 12, duplicates are a no-op).
- `CustomReportTools` — `last_n_sales` without `split_by` aggregates the window (`CustomReportLogic.MergeRows`).

## Access and audit
Any signed-in user can use every agent and Reports generation (tools are read-only). Generated decks and scheduled specs are audit-logged (who, what, when — not the data). Usage is logged per agent; only admins see it.

## Known limits (be honest with users)
- **Archive gap.** The MSL archive can stop before the active catalogue's sale (for example archive to sale 32/2026 while the catalogue is sale 39). Each workspace shows a notice, and Analytics/Reports figures stop at the archive's last sale.
- **No "13 years" period in the Reports builder** — it would run a query per sale across the whole archive. The Analytics agent can still answer archive-wide questions.
- **Voice** works in Chromium browsers (Chrome/Edge); elsewhere the button is disabled and typing works. Sinhala/Tamil recognition and speech depend on the device having voices; voice *commands* in the Reports builder are English only.
- **Workspace text is English only.** The hub is translated (en/si/ta, drafts awaiting native review — see [assistant-hub-i18n-review.md](assistant-hub-i18n-review.md)); the workspaces are not yet.
- **Source chips** appear on live replies; they are not stored with conversation history.
- **Price ladder** compares valuations, not sale results.

## Testing
Frontend (Vitest + Testing Library): `test/agent-hub*.test.ts(x)`, `general-`, `auction-`, `analytics-`, `reports-workspace`, `voice-builder`, `phase5-extras`, `sources-usage`, and `assistant-a11y` (axe-core over the hub and all workspaces; colour contrast and layout need a real browser). Backend (xUnit, no Mongo): `CustomReport*Tests`, `CustomDeckGeneratorTests` (OpenXml schema validation + exact chart values), `SourceTrackerTests`, `AnalyticsPinsTests`. Real-browser checks used Playwright with mocked API routes; **run archive queries one at a time** — a cold archive query can exhaust RAM on a small machine (see the notes in the Reports Agent documentation).

To view a generated deck without PowerPoint, LibreOffice can render it; its PNG export renders only the first slide, so make copies with the leading slides removed.

## Not built yet
- Real-PowerPoint and real-microphone verification, and a live-archive verification of the preview and scheduled job.
- Translating the workspaces.
- A dedicated Exports-page listing for generated files (they are in Saved Reports).
