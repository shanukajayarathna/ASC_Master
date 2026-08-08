# ASC — Tea Auction Valuation & Business Intelligence Platform

Full re-platform of the original single-file HTML/CSS/JS app onto:

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + Material UI + AG Grid Enterprise
- **Backend**: ASP.NET Core (.NET 9) Web API + MongoDB.Driver
- **Database**: Two-tier. Catalogue/lot data is **file-based** — weekly sale Excel files under `data/sales`, read by `SaleFileStore`. User-entered state (valuations, users, saved reports/filters, API keys, webhooks) lives in **MongoDB** (chosen for now to make local testing frictionless — no Docker/install required if MongoDB is already on the machine)

The old vanilla-JS build (`index.html`, `css/`, `js/`) is left in place, untouched, as a reference — it still works standalone if you just open `index.html`.

## What's actually wired end-to-end right now

- Catalogues are **file-backed**, not database-backed: the weekly-sale Excel files under `data/sales` (named `01.xlsx` … `30.xlsx`) ARE the store (`SaleFileStore`), auto-discovered on every listing. "Import" through the app just saves the uploaded file into that folder — a filename numbered like the weekly files slots into that exact sale (re-uploading a number replaces it), any other name gets the next free sale number. Parses are cached to `data/.cache` (gzipped JSON keyed by file size+mtime) so reloads after the first parse are fast. MongoDB holds only user-entered state layered on top — valuations, users, saved reports/filters, API keys, webhooks, etc. — never the catalogue/lot data itself.
- **Dashboard** — KPI tiles computed from the current sale's lots
- **Catalogue Manager** — AG Grid Enterprise grid bound to the imported lots, with the Enterprise column/filter side panel, row selection, and CSV/Excel export built into the grid itself
- **Valuation drawer** — open a ticket, enter a From/To range or single value, pick a classification (Best/Below Best/Poor), add remarks, save — persisted to MongoDB via `PATCH /api/lots/{id}/valuation` and merged back onto the file-backed lot on read
- **Bulk operations** — select multiple rows, bulk-classify or bulk-clear-notes via the API
- Light/dark theme toggle, matching the original brand palette, applied consistently across Tailwind and the MUI theme and the AG Grid theme (AG Grid's v36 Theming API reads the same CSS custom properties, so it follows the toggle automatically)

Verified by hand against a real local MongoDB: import → list → paged/filtered lot query → valuation update → dashboard aggregates recompute, all round-tripped correctly. (Catalogue deletion is deliberately not exposed through the app — removing a sale means removing its Excel file from `data/sales`.)

## Current status

All modules listed in the app's navigation (Dashboard, Catalogue Manager, Valuation Centre, Analysis, Reports, Broker Comparison, Market Intelligence, Saved Reports, Saved Filters, Data Import, Exports, Knowledge Base, AI Assistant, Settings, Help) are real, working features — not placeholders. The sidebar-era "Coming soon" framing that used to live in this section is gone; the redesign in commit `f85b306` replaced the sidebar with a dashboard-first launchpad, and every tile there is `status: "live"`. See [`/docs`](docs/README.md) for the current, maintained module-by-module reference — treat that directory, not this section, as the source of truth for what's built.

Authentication now protects the whole API, not just `api/v1/auth`: every controller and module carries `[Authorize]` (Admin-only where appropriate — user/role management, API keys, webhooks, dev seeding). See [`docs/18_Security.md`](docs/18_Security.md) for the full policy.

Still genuinely outstanding: server-side row model for AG Grid (current grid loads up to 5,000 rows client-side per catalogue, matching the old app's approach; true virtualization for 100k+ row catalogues needs a datasource implementation), and a real AG Grid Enterprise license key (see below).

## Running it locally

### 1. MongoDB

Needs a MongoDB server reachable at the connection string in `backend/Asc.Api/appsettings.json` (`ConnectionStrings:Mongo`, defaults to `mongodb://localhost:27017`, database name `asc_tea`) — or override it locally with `dotnet user-secrets set "ConnectionStrings:Mongo" "..."` from `backend/Asc.Api` (e.g. to point at a MongoDB Atlas cluster instead; never put real credentials in `appsettings.json`, that file is committed). If you have MongoDB installed as a Windows service, just make sure it's running:

```powershell
Get-Service -Name MongoDB | Start-Service   # if not already running
```

No schema/migration step needed — collections and indexes are created on first write.

### 1a. JWT signing key (needed to log in)

`api/v1/auth/login`/`register` won't issue usable tokens until a signing key is set — same pattern as the Mongo connection string above, never committed to `appsettings.json`:

```bash
cd backend/Asc.Api
dotnet user-secrets set "Jwt:Key" "$(openssl rand -base64 48)"   # any long random string works
```

The API itself still starts fine without this set — only login/token issuance needs it, every other endpoint is unaffected.

### 1b. OpenAI API key (needed for the Knowledge Base and the AI Assistant)

Uploading/searching documents (`api/v1/documents`) embeds text via OpenAI, and the AI Assistant's chat (`api/v1/assistant`) also runs on OpenAI (`gpt-5.1`) — one key covers both. Same pattern again, your own key, never committed:

```bash
cd backend/Asc.Api
dotnet user-secrets set "OpenAI:ApiKey" "sk-..."
```

Get a key from platform.openai.com if you don't have one. Everything else still works without it — only the Knowledge Base page and the AI Assistant need it.

### 2. One-time setup

```bash
npm install               # root — installs `concurrently`, used to run both dev servers together
cd frontend && npm install && cd ..
cp frontend/.env.local.example frontend/.env.local   # edit if your API isn't on localhost:5058
```

### 3. Run both frontend and backend together

From the repo root:

```bash
npm run dev
```

This starts the ASP.NET Core API (`http://localhost:5058`, labeled `[API]`) and the Next.js dev server (`http://localhost:3000`, labeled `[WEB]`) together in one terminal, interleaved and color-coded. `Ctrl+C` stops both.

To run them separately instead (e.g. in two terminals, or for debugging one in an IDE):

```bash
# terminal 1
cd backend/Asc.Api && dotnet run          # http://localhost:5058, Swagger at /swagger

# terminal 2
cd frontend && npm run dev                # http://localhost:3000
```

### AG Grid Enterprise license

No license key is configured (I don't have one to give you — it's a paid product from ag-grid.com). Without one, Enterprise features (column/filter side panel, etc.) work in development but the grid shows a watermark and a console warning. Buy a key at https://www.ag-grid.com/license-pricing/ and set `NEXT_PUBLIC_AG_GRID_LICENSE_KEY` in `frontend/.env.local`.

## Project layout

```
package.json    root dev-orchestration only (`npm run dev` via `concurrently`) — not a workspace, each side has its own dependencies

backend/
  Asc.Api/
    Models/         Catalogue, Lot (embeds Valuation), FilterPreset, ActualPrice, SavedReport
    Data/           MongoContext (MongoDB.Driver client + collection accessors — user state only)
    Services/       SaleFileStore (the catalogue store), CatalogueImportService (xlsx/csv parsing), LotMediaStore
    Controllers/    CataloguesController, LotsController, DashboardController, ExportController, LotMediaController, DevSeedController
    Modules/        one folder per feature area — Auth, ApiKeys, Webhooks, Documents (Knowledge Base), Assistant, Analytics, Market, Reports, FilterPresets — each with its own controller/DTOs/model, not spread across the shared folders above

frontend/
  src/
    app/            one folder per route, grouped under (app)/ (dashboard, catalogue, valuation, analysis, market, broker, reports, assistant, knowledge, exports, data-import, saved-reports, saved-filters, settings, help, worksheet) plus a standalone login/
    components/
      shell/         Topbar, command palette, nav config — no persistent sidebar (dashboard-first launchpad, see docs/04_Navigation_Architecture.md)
      home/           launchpad tiles, recent/attention lists, AI insights panel — the dashboard-first landing surface
      catalogue/      CatalogueGrid (AG Grid), FilterPanel, ValuationDrawer, AG Grid theme/setup
      valuation/      ticket-level valuation UI — photo/voice capture, sub-grade and keyword chips
      dashboard/      KpiTile, KpiSection
      analytics/      chart components shared by Analysis/Broker/Market pages
    context/         CatalogueContext, AuthContext, ThemeModeContext
    lib/             api.ts (typed fetch client), plus per-concern helpers (filters, exports, classifications, sub-grade, etc.)
    theme/           MUI theme + ThemeRegistry (App Router cache provider)
    types/           TypeScript types mirroring the API DTOs

index.html, css/, js/   the previous vanilla-JS build — untouched, still works standalone
```
