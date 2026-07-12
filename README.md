# ASC — Tea Auction Valuation & Business Intelligence Platform

Full re-platform of the original single-file HTML/CSS/JS app onto:

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + Material UI + AG Grid Enterprise
- **Backend**: ASP.NET Core (.NET 9) Web API + MongoDB.Driver
- **Database**: MongoDB (chosen for now to make local testing frictionless — no Docker/install required if MongoDB is already on the machine; swapping to Postgres/EF Core later is a contained change scoped to `backend/Asc.Api/Data` and the controllers)

The old vanilla-JS build (`index.html`, `css/`, `js/`) is left in place, untouched, as a reference — it still works standalone if you just open `index.html`.

## What's actually wired end-to-end right now

- Import a catalogue (.xls/.xlsx/.csv) → uploaded to the API → parsed server-side (ClosedXML / a CSV parser) → stored in MongoDB (`catalogues` + `lots` collections; the full original row is kept on each lot document, common fields like Lot Number/Broker/Grade/Garden/etc. are also promoted to typed top-level fields; the taster's ticket is embedded directly on the lot document since it's always 1:1)
- **Dashboard** — KPI tiles computed from the lots in MongoDB
- **Catalogue Manager** — AG Grid Enterprise grid bound to the imported lots, with the Enterprise column/filter side panel, row selection, and CSV/Excel export built into the grid itself
- **Valuation drawer** — open a ticket, enter a From/To range or single value, pick a classification (Best/Below Best/Poor), add remarks, save — persisted via `PATCH /api/lots/{id}/valuation`
- **Bulk operations** — select multiple rows, bulk-classify or bulk-clear-notes via the API
- Light/dark theme toggle, matching the original brand palette, applied consistently across Tailwind and the MUI theme and the AG Grid theme (AG Grid's v36 Theming API reads the same CSS custom properties, so it follows the toggle automatically)

Verified by hand against a real local MongoDB: import → list → paged/filtered lot query → valuation update → dashboard aggregates recompute → delete, all round-tripped correctly.

## What's a placeholder ("Coming soon" page in the sidebar)

Analysis, Reports, Broker Comparison, Market Intelligence, Saved Reports, Saved Filters, Settings. These all shipped as real, working features in the previous vanilla-JS build (see the code still sitting in `js/analysis.js`, `js/broker.js`, `js/market.js`, `js/reports.js`, etc.) — porting them means adding the matching aggregation/report endpoints on the API and then rebuilding the UI as React components. That's the next phase, not started here.

Also out of scope so far: authentication/roles (there is no login yet — anyone who can reach the API can read/write everything), server-side row model for AG Grid (current grid loads up to 5,000 rows client-side per catalogue, matching the old app's approach; true virtualization for 100k+ row catalogues needs a datasource implementation), and a real AG Grid Enterprise license key (see below).

## Running it locally

### 1. MongoDB

Needs a MongoDB server reachable at the connection string in `backend/Asc.Api/appsettings.json` (`ConnectionStrings:Mongo`, defaults to `mongodb://localhost:27017`, database name `asc_tea`) — or override it locally with `dotnet user-secrets set "ConnectionStrings:Mongo" "..."` from `backend/Asc.Api` (e.g. to point at a MongoDB Atlas cluster instead; never put real credentials in `appsettings.json`, that file is committed). If you have MongoDB installed as a Windows service, just make sure it's running:

```powershell
Get-Service -Name MongoDB | Start-Service   # if not already running
```

No schema/migration step needed — collections and indexes are created on first write.

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
    Models/        Catalogue, Lot (embeds Valuation), FilterPreset, ActualPrice, SavedReport
    Data/           MongoContext (MongoDB.Driver client + collection accessors)
    Services/       CatalogueImportService (xlsx/csv parsing, column/type detection)
    Controllers/    CataloguesController, LotsController, DashboardController

frontend/
  src/
    app/            one folder per route (dashboard, catalogue, valuation, analysis, ...)
    components/
      shell/         Sidebar, Topbar, nav config
      catalogue/      CatalogueGrid (AG Grid), ValuationDrawer, AG Grid theme/setup
      dashboard/      KpiTile, KpiSection
      shared/         ComingSoon placeholder
    context/         CatalogueContext (active catalogue + list), ThemeModeContext
    lib/             api.ts (typed fetch client), format.ts
    theme/           MUI theme + ThemeRegistry (App Router cache provider)
    types/           TypeScript types mirroring the API DTOs

index.html, css/, js/   the previous vanilla-JS build — untouched, still works standalone
```
