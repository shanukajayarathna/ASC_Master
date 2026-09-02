# 29 — Mark Intelligence

## Purpose
Define the module that curates a durable Plantation → Factory → Mark → Broker reference
hierarchy on top of the raw multi-broker Msl archive, and — the focus of this document —
the automated reconciliation that keeps that hierarchy's ASC-specific state (does ASC
still sell this mark, is it newly shared) current without a live re-derivation on every
report request.

Not to be confused with [12_Market_Intelligence.md](12_Market_Intelligence.md) ("Market
Intelligence"), an unrelated feature (`Modules/Market`) comparing platform valuations
against actual post-sale prices.

## Scope
`Modules/MarkIntelligence` (`api/v1/mark-intelligence`) and the two scheduled jobs it
registers into `Modules/ScheduledReports`. Not the mining of the base hierarchy itself
(`MarkIntelligenceMiningService`, a manual/one-shot re-runnable job) — this document
extends that with the automated ASC-activity layer described below.

## Responsibilities
- Maintain `Plantation`/`Factory`/`Mark`/`MarkBrokerEra`/`MarkBrokerPeriodFact` (existing —
  see the module's own code comments for the base hierarchy).
- Reconcile ASC's own weekly sale files (`/data/sales`) against the Msl archive to
  determine, per mark, whether ASC currently sells it.
- Detect when a mark's broker set changes to include a broker it didn't have before, in
  either direction.
- Persist both as durable, indexed Mongo state so any future report job can query them
  directly rather than re-deriving anything live.

## Two data sources, one precedence rule

| Source | Covers | Authoritative for |
|---|---|---|
| `/data/sales` (`ICatalogueSource`/`SaleFileStore`) | ASC's own weekly sale files — files ARE the store | The 2 most-recent sales (current + prior) |
| Msl archive (`auctionLots`, mined into `MarkBrokerPeriodFact`) | Full 2013–present, all Colombo brokers | Everything strictly older than the 2 most-recent `/data/sales` sales |

This split exists because the archive lags — this week's sale may not be mined into it
yet — while `/data/sales` only ever holds ASC's own recent activity, not the full
cross-broker picture needed for shared-mark detection or older history. A mark's join key
is `Mark.Code` (the normalized selling-mark name, already globally unique across both
sources — see `MarkIntelligenceModels.cs`'s design note); no new join key was introduced.

## The two triggers

Both are `IScheduledReportJob`s (`Modules/MarkIntelligence/MarkAscActivityCheckJob.cs`,
sharing `MarkAscActivityCheckService`'s reconciliation logic), registered weekly
(Monday, staggered an hour apart — see `Program.cs`) so a mark's status re-evaluates
against fresh data every week rather than only once per quarter:

- **`mark-activity-3mo`** ("ASC Mark Activity — 3 Month Check")
- **`mark-activity-6mo`** ("ASC Mark Activity — 6 Month Check")

Both are visible/toggleable/manually-runnable in the existing Admin Panel Automated
Reports UI with no frontend change (it lists `IScheduledReportJob`s generically).

Status is computed the same way regardless of which job runs: `AscActivityStatus` is a
pure function of the reconciled last-ASC-activity date against **both** thresholds
together — `Active` within 90 days, `AtRisk` within 180 days, `Lost` beyond it — never
against a single job's own window in isolation. An earlier version had each job resolve
independently against only its own threshold ("within my window → Active"), which meant
the 6-month job's wider check silently overwrote the 3-month job's stricter `AtRisk`
verdict on every run for any mark 90–180 days stale, so the early-warning state was only
ever visible for the hour between the two jobs. Keeping two separate job registrations
still satisfies the two named triggers and gives independent schedule/enable-disable/
run-history in the Admin Panel (plus redundancy if one is disabled or fails) — it's no
longer what produces the severity distinction, since both now call the identical
evaluation.

Every run is still a full stateless recompute per mark (no incremental patching),
matching the base mining job's own re-run philosophy — with one deliberate exception: if
a run finds no fresh evidence at all for a mark, it falls back to that mark's previously
recorded `LastAscActivityAt` rather than discarding it, since `/data/sales` is only
authoritative for the 2 most-recent sales and the archive only reflects whichever manual
mining run last ran — a real ASC sale from further back can briefly have no
representation in either source until mining catches up, and that gap shouldn't misread
as the mark going stale.

`AscActivityStatus` (`Active`/`AtRisk`/`Lost`, stored on `Mark`) is deliberately separate
from the existing `Status` field (`Active`/`Discontinued`) — `Status` tracks whether the
mark exists at all (any broker); `AscActivityStatus` tracks ASC's own relationship to it.
`Mark.IsCurrentlyOurs` is a computed convenience (`AscActivityStatus != Lost`); code that
needs to filter/index on this should use the stored `AscActivityStatus` field instead,
since a computed property can't be indexed.

## Shared-mark detection

Piggybacked on the same weekly run (it already has the reconciled broker picture): each
run computes an "effective broker set" for a mark — the existing `Mark.CurrentBrokers`
(from the base mining job) with `"AS"` folded in or out per that run's own ASC-activity
finding, so a mark `/data/sales` just revealed as ASC's isn't missed while the manual
mining job hasn't caught up yet. This is compared against `Mark.LastKnownBrokerSet` (the
baseline from the previous run, either job); a broker gained in either direction — ASC
picking up a previously-other-broker mark, or another broker picking up a previously
ASC-only mark — flags `NewlySharedDetected` on that run's snapshot.

## Durable snapshot shape

`MarkActivitySnapshot` — one document per mark per trigger run, never overwritten (unlike
`Mark`'s own cached fields), the same "sits alongside, doesn't replace" relationship
`MarkBrokerPeriodFact`/`MarkBrokerEra` already have with `Mark`:

```
MarkId, TriggerKey ("mark-activity-3mo" | "mark-activity-6mo"), RunAt,
Status, IsCurrentlyOurs, LastAscActivityAt, StatusChanged,
BrokerSetAtRun, NewlySharedDetected, NewlyIncomingForAsc
```

This is the collection a future report job queries directly — e.g. "all marks ASC lost in
the last 6 months" is `MarkActivitySnapshot` filtered on `Status == Lost` and `RunAt`
within the window; "all currently shared marks and who they're shared with" reads
`Mark.CurrentBrokers`/`IsCurrentlyShared` directly (already existing, always current) with
`MarkActivitySnapshot` supplying *when* a share began. No live re-mining required for
either.

`Mark.FirstSeenWithAsc` is set once, the first time a mark with no prior ASC activity is
found active — the minimal "newly incoming for ASC" signal (a timestamp only; no
notification integration yet — see Open questions).

## New-mark detection (unresolved marks)

Neither the mining job nor the two ASC-activity triggers create a `Factory`/`Mark` from a
`/data/sales` row alone — a real `Factory` needs a resolved MSL code, and `/data/sales`'
own factory field is a raw, broker-varying code that can only safely be resolved to an
`Factory.Code` via the archive (see `MarkIntelligenceMiningService`'s design notes on
raw-code-to-MslCode resolution). So when a run finds a `SellingMark` in `/data/sales` with
no matching `Mark.Code` anywhere — a genuinely new mark ASC has started selling that the
archive hasn't been mined for yet and no admin has added by hand — it doesn't fabricate a
`Factory`/`Mark`. It surfaces the gap instead: `UnresolvedMarkSighting`, upserted by
`MarkCode` (its natural key) on every run the sighting recurs (`FirstSeenAt`/`LastSeenAt`/
`SightingCount`), and marked `Resolved` automatically once a real `Mark` with that code
exists — via the next mining run, or an admin adding it through the Admin Panel. No
separate cleanup job is needed.

Surfaced via `GET activity/unresolved-marks` and the `UnresolvedMarks` count on
`GET activity/summary`; shown as a small panel in the Admin Panel's Mark Intelligence
section next to the existing "Run Mining" button, alongside the AtRisk/Lost/newly-
incoming/newly-shared counts.

## API surface

`api/v1/mark-intelligence/marks/{id}/activity` (one mark's snapshot history),
`api/v1/mark-intelligence/activity/changes?window=3mo|6mo&kind=AtRisk|Lost|NewlyIncoming|NewlyShared`
(cross-mark list, backs the Activity Alerts UI), `api/v1/mark-intelligence/activity/summary`
(aggregate counts for the Admin Panel), `api/v1/mark-intelligence/activity/unresolved-marks`
(sale-file marks with no matching Mark yet). All read-only, no special policy — same tier
as the existing `Search`/`GetMark` endpoints (internal reference data, not public).

## UI behaviour
The existing `/mark-intelligence` page's mark detail view shows the ASC-activity status
alongside the existing broker chips/era timeline. A segmented control switches between the
existing plantation→factory→mark drill-down ("Browse") and a flat "Activity Alerts" list of
currently AtRisk/Lost/newly-incoming/newly-shared marks. The Admin Panel's Mark
Intelligence section shows the same summary counts next to its existing "Run Mining"
button.

## Dependencies
[Modules/MarkIntelligence's mining job] (base hierarchy, unchanged), `Modules/ScheduledReports`
(job registry/runner pattern, reused not duplicated), `SaleFileStore`/`ICatalogueSource`
(`/data/sales` access).

## Future expansion
The report pipeline this foundation exists for: any new `IScheduledReportJob` can query
`MarkActivitySnapshot`/`Mark.AscActivityStatus` directly. A `Notifications` integration for
newly-incoming/newly-shared marks (currently timestamp-only) is a natural next step once a
real consumer needs it.

## Open questions
- Whether `FirstSeenWithAsc`/`NewlySharedDetected` should eventually push an in-app
  `Notification` (`Modules/Notifications`) rather than staying query-only.
