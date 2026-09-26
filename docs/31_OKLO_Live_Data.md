# 31 — OKLO live sale data

Sale data comes from the OKLO SmartAuction API instead of hand-downloaded Excel files. The
module is `backend/Asc.Api/Modules/Oklo/`.

**Current design (live view + snapshots).** A sale is loaded from OKLO into memory when it is opened
(`OkloLiveSales`, progressive: first rows in seconds, the whole sale in about a minute) and every complete
pull is stored as a compressed snapshot in MongoDB (`saleSnapshots`, `SaleSnapshotStore`). After a restart
a sale is served from its snapshot at once and refreshed from OKLO in the background; a background
backfill (`OkloBackfillService`) pulls every sale once, newest first, throttled, so history is available
without OKLO. `LiveCatalogueSource` puts this in front of `SaleFileStore`: catalogue pages and single-sale
reports read live/snapshot first; the saved workbooks are only a fallback. The file-writing sync described
under "Legacy file sync" below is off by default and no longer needed.

## Configuration (`Oklo:*`, user-secrets — never in the repo)

| Key | Value |
|---|---|
| `TokenUrl` | Azure B2C ResourceOwner token endpoint (from OKLO's onboarding email) |
| `BaseUrl` | `https://smartauctionreports.okloapps.com` (the PDF's `smartauctionapimanager…` host no longer exists) |
| `Scope`, `ClientId`, `ClientSecret` | from OKLO's onboarding email |
| `Username`, `Password` | the API user (the account name; set in user-secrets / `.env`, never committed); password grant — a password is mandatory |
| `AutoSync` | `true` to run the background refresh loop (default `false`) |
| `RecentWindowDays` / `RecentRefreshMinutes` / `LiveRefreshMinutes` / `ArchiveRefreshHours` / `CatalogListMinutes` / `BackgroundPauseSeconds` / `PageSize` / `FirstYear` | tuning, see `OkloOptions`. `FirstYear` defaults to 2024 (what existed as files); set 2022 to also import 2022-2023 (2021 is empty in OKLO). |

Set with `dotnet user-secrets set "Oklo:AutoSync" "true"` in `backend/Asc.Api`. Docker: carry the
same keys as `Oklo__…` environment variables.

## How it works

- `OkloClient` — token (cached, ~4.3h lifetime), retries, `get-catalog-by-status` (Open 3,
  Published 4, Auctioned 1020, Closed 2056) and `Reports/general-report`. The live API differs
  from the 2022 PDF: paging is mandatory (`pageNumber`/`pageSize`, `ignorePaging` alone → 400)
  and a 3,000-row page takes ~10s, so a whole sale is ~4 pages, fetched two at a time.
- `OkloSaleMapper` / `OkloSaleWriter` — reproduce the export's exact columns (two header rows,
  blank buyer sub-columns, valuation ranges as `900 - 950`, Sri Lanka local `Selling End Time`).
  Verified against sale 37/2026: 10,269 lots, all comparable fields identical apart from lots
  sold after the reference file was downloaded.
- `OkloSyncService` — decides what is due and writes only when content changed (SHA-256 of the
  rows). Tiers: **live** (auction date ±1 day, every 2 min), **recent** (open/published or within
  21 days, every 5 min, backing off to 60 min while nothing changes), **archive** (older, daily); never-imported sales back-fill newest-first. Every third step is reserved for archive/back-fill, because one sale takes ~75s to pull and the recent tier would otherwise never go idle.
  An empty API answer never replaces an existing file.
- `OkloSyncBackgroundService` — the loop. `POST /api/oklo/refresh` (any signed-in user) wakes it
  to re-pull recent/live sales older than two minutes — this is the "refresh when the system is used".
- **Reload = refresh.** Loading or reloading any page makes the app call `POST /api/oklo/refresh-now` (once per full page
  load; the (app) layout stays mounted across in-app navigation). The backend then re-pulls the sales in use from OKLO
  immediately (`OkloLiveSales.RefreshNow`): the named sale (the user's active one) plus the two newest active sales, skipping the
  normal refresh window. Rate-limited to one forced pull per sale per `Oklo:ForceRefreshMinSeconds` (60), never applied to
  finished sales, and a sale already pulling is left to finish. The Catalogue Manager then checks every 8s (for 3 minutes) and
  updates itself the moment the new copy lands.
- `GET /api/oklo/freshness` (all users) for an "as of" stamp; `GET /api/oklo/status` and
  `POST /api/oklo/sync/{year}/{saleNo}` are Admin-only (`ManageDataFiles`).
- State lives in `data/oklo/state.json`.

## Lot identity

API-built files carry a trailing **Auction Item Id** column, and `SaleFileStore` uses it as the
lot's row key (`a_<id>`). A live refresh that changes a lot's price/status therefore keeps its id
and cannot orphan a stored valuation (the legacy content-hash key changes with every edit).
The first time a hand-downloaded file is replaced, the sync snapshots its lot ids
(`data/oklo/legacy-ids-*.json`), writes the API file, then re-links stored valuations (Mongo) and
`data/media/{lotId}` folders by broker + lot number. The snapshot is deleted only after the
re-link finishes, so an interrupted run resumes.

## Caveats

- Resource use (measured on the 8 GB dev laptop): one full sale ≈ 29 MB download, ~10 s CPU, +450 MB transient RAM, ~5 MB on disk. Back-fill is throttled (`BackgroundPauseSeconds`) and each written sale is parsed once immediately so its lot count shows in the catalogue list. `SaleFileStore.MaxLoadedSales` (60) is deliberately NOT lowered: yearly reports walk ~50 sales in a row and a smaller LRU would evict and reload every one of them.
- The API has no push/webhooks — "real time" is polling, so data is minutes old, not seconds.
- OKLO history starts in 2021; catalogues whose sale number isn't numeric (its mock/test
  catalogues, `Sale 35-SEP13` etc.) are skipped.
- Post-auction (out-lot) sales keep changing rows for weeks, which is why recent sales are
  re-pulled every few minutes and older ones daily.
- The two `catalog-item-excel/upload-excel-file` endpoints write into OKLO and are deliberately unused.

## Snapshots, backfill and health

- `saleSnapshots` (MongoDB): one document per sale — the raw OKLO lots, gzip JSON (~1 MB per 10,000 lots) plus
  `year`, `saleNo`, `fetchedAtUtc`, `total`. A complete pull replaces it. Finished sales are final and are never
  re-pulled; sales in the recent window (default 21 days, or open/published) are re-pulled when 6h+ old.
- Read order for a sale (`LiveCatalogueSource`): in memory → stored snapshot → live pull (active sale, or an old
  sale with neither a file nor a snapshot — at most 2 per 10 minutes, so a many-sale report cannot trigger hours of
  downloads) → saved workbook. Synchronous callers block a request thread only 3 at a time, waiting at most 5s for a turn.
- OKLO requests share one cap of 4 in flight; background work (backfill, warm-up, size probes) may use 2 of them.
- `GET /api/oklo/health` (Admin): sale-list age (a stale list means OKLO is unreachable), sales in memory and their
  errors, stored snapshots (`stored` of `of`, oldest pull), recently failing backfills. Point an uptime check at it.
  A warning is logged when the sale list is 30+ minutes old.
- `POST /api/oklo/migrate-valuations` (Admin) finishes any valuation / lot-media re-link still pending from the move to
  OKLO's stable lot ids. It also runs by itself every 10 minutes until nothing is pending.
- Settings: `Oklo:SnapshotBackfill` (default true), `Oklo:BackfillPauseSeconds` (20), `Oklo:LiveView` (true),
  `Oklo:MaxLiveSales` (8), `Oklo:ViewTtlLiveMinutes` / `ViewTtlRecentMinutes` / `ViewTtlArchiveHours` (2 / 10 / 6).

## Catalogue Manager search (no whole-sale download)

The Catalogue Manager no longer downloads a sale to the browser to filter it. The filter panel edits a *draft*;
**Search** (or Enter in a text field) sends it to the server, which filters the sale where it already lives (memory /
stored snapshot) and returns only the matching rows.

- `POST /api/catalogues/{id}/lots/search` — body: `search`, `columnFilters` (the panel's categorical / numeric / text /
  lot filters), `status`, `classification`, `year`, `offset`, `limit` (max 20,000). Returns the matching window plus
  `total` matches and the live-load state. The rules are a one-for-one port of the browser filter
  (`Services/LotSearch.cs` ⇔ `frontend/src/lib/lotFilters.ts`, including JavaScript `parseFloat` semantics) and are
  covered by `LotSearchTests`.
- `POST /api/catalogues/{id}/filter-options` — distinct values (most frequent first) for the columns the panel offers
  as dropdowns, so the browser needs no lots to fill them. They don't narrow as other filters change (Search is the
  step that applies filters).
- **Nothing is loaded when the page opens.** Year and Sale (a sale picker, not a filter — Year lists no "All") default to the
  latest year's latest sale; choosing a sale fetches only its column list and the dropdown option lists. The results area is an
  empty box until Search (or Enter in any filter box) is pressed; only the matching rows (up to 20,000 per sale) are then loaded.
- Dropdown keyboard rules: arrows move the highlight and Enter picks it (the list then closes, so the next Enter runs the
  search); a mouse tick keeps the list open for picking several values. Very long lists (> 1,500 options, e.g. lot numbers)
  are drawn virtually with keyboard scrolling; shorter ones are ordinary MUI lists.
- While a sale is still arriving from OKLO the dropdown lists (and, once a search has been made, its results) refresh every 3s
  until it is complete; an open page with results checks every 30s for a newer pull and repeats the applied search silently.
- Pooled multi-sale views search each sale separately; the "Sale" column filter chooses which sales are searched.

## Deployment checklist

- **MongoDB** must be reachable — snapshots, valuations and notes all live there. Budget ~300 MB for 141 sales of snapshots.
- **Memory**: each sale held in memory is a few hundred MB while loading (measured +450 MB peak). With `MaxLiveSales=8`
  give the API container 2-4 GB. Lower `MaxLiveSales` to trade memory for reload time.
- **Credentials**: set `OKLO_*` (see `.env.example`) from a secret manager, never the repo. The API user authenticates
  with a password (OAuth password grant): agree a rotation process with OKLO — the client secret was shared in plain
  text once and should be rotated. Ask OKLO for a service identity (client credentials), rate limits, an SLA and
  whether a bulk export / change feed exists.
- **Terms of use**: confirm OKLO allows storing their data (snapshots) and showing it to all internal users.
- **More than one API instance**: they share snapshots through MongoDB, so a restart or a second instance starts warm.
  Each instance still keeps its own in-memory copies and runs its own warm-up/backfill, which multiplies the OKLO
  load slightly — run the backfill on one instance (`Oklo:SnapshotBackfill=false` on the others).
- **First deploy**: the backfill needs several hours to store every sale (one at a time, ~2 minutes each). Recent sales
  are available immediately (loaded on demand); older sales fall back to a live pull (limited) until stored.
- **Still file-based**: reports that read many sales at once take their data through the same source, so they see
  stored snapshots; the mark-code index and shared-factory dates are built from it too and keep any entries already
  computed. A fresh install with no snapshots yet shows them only for sales already loaded.

## Legacy file sync

`OkloSyncService` (`Oklo:AutoSync=true`) can still write API-built workbooks into `data/sales`. It is off by default:
the live view + snapshots replace it. The lot-id re-link (`legacy-ids-*.json`) is independent of it.
