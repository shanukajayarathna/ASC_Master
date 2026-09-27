# 32 — Factory Wise Averages & the sibling monthly reports

Monthly reports of every factory's Colombo auction sales (all brokers): quantity and average price
(Rs/kg) by elevation, **main grade vs off grade**, **monthly and year-to-date**, with the factory's
rank in its elevation. They are the archive's factory-level price history.

## Files

`data/msl/factory-averages/<year>/factory-averages-<YYYY>-<MM>.txt` — one report per month,
January 2023 onward, as UTF-8 text (the reporting system writes UTF-16; both are accepted).
Jan–Dec 2018 and Mar/Jun/Jul 2019 exist only as PDFs and are archived unparsed. See
`data/msl/README.md` for the sibling report folders (grade analysis, combined averages,
plantation ranking) and `data/msl/factory-averages/manifest.csv` for where every file came from.

## Parser — `Modules/Msl/FactoryAverages/FactoryAveragesParser.cs`

Fixed 132-column print-out, one elevation at a time. Each factory is two lines: the name line holds
eight right-aligned number columns (main monthly/cumulative kg, off monthly/cumulative kg, total
monthly kg + rank, total cumulative kg + rank); the MF-code line under it holds the matching
average prices. Blank cell = no sales (null). `ELEVATION TOTAL` and `GRAND TOTAL` line pairs close
each elevation and the report; they are kept as rows (`RowType`) so a month can be reconciled.

- The month/year come from the title line inside the file, never the file name.
- Older layouts return `null` (archived only). A recognised report with a line that doesn't fit the
  columns **throws** — a changed layout fails loudly instead of importing wrong numbers.
- `Reconcile` checks factories → elevation totals → grand total. Verified on all 89 reports
  (≈59k rows): everything balances except three inconsistencies in the source itself
  (Jan 2022 Uva High total is 26,420 kg above its listed factories; May 2026 Western High off-grade
  is 49.5 kg out; Radella Jan 2025 / Loinorn May 2026 have totals that don't equal main + off).
  These are logged at import, not rejected.
- Cross-checks: the August 2026 grand total (19.53M kg @ Rs 1,178.27) is within 0.4% of the Tea
  Board's All Tea figure for the same month, and Low Grown within 0.14%.

## Database — collection `factoryAverages`

One `FactoryAverage` document per factory per elevation per month (`RowType` FACTORY), plus
ELEVATION_TOTAL and GRAND_TOTAL rows. Key = `MfCode` (names vary between reports). Indexes
(Migration002): (Year, Month, Elevation), (MfCode, Year, Month), SourceFile. Imported by
`MslImportService` (same watcher, idempotent per file, `~N` copies only fill an empty month).

## API — `GET /api/v1/msl/factory-averages`

- `/months` — months available with factory count and grand total.
- `/?year=&month=&elevation=&code=&q=&rowType=&limit=` — one month (latest by default); `rowType`
  FACTORY (default) | ELEVATION_TOTAL | GRAND_TOTAL | ALL.
- `/factory/{mfCode}?fromYear=` — one factory's monthly history.

## AI assistant — `Modules/Agents/FactoryAverageTools.cs`

The Analytics Agent has two read-only tools over this table (wired in `AnalyticsToolExecutor`,
attributed to the "MSL auction archive" source chip):

- `get_factory_averages` — one month's factory table (latest by default), filterable by elevation
  (`HIGH`/`MEDIUM` cover both regions), factory name or MF code; sorted by quantity, price
  (factories under `minQtyKg`, default 10,000, are excluded so a tiny lot can't top the list) or rank.
  Returns a scope line, a pre-formatted `markdownTable` (pasted verbatim by the agent) and the
  elevation/month totals.
- `factory_history` — one factory's monthly series with a first→last change summary; a name that
  matches several factories returns the candidates so the agent asks which one.

Refuse tea is included here (the reports don't separate it), unlike the per-sale rollups.

## The other monthly reports

Three more report kinds share this folder family and follow the same pattern (parser with a built-in
`Reconcile`, one MongoDB collection, one read API, indexes in Migration003). All are imported by
`MslImportService` and re-read on change.

| Report | Folder | Collection | API | Reconciliation |
|---|---|---|---|---|
| Grade analysis (elevation × grade, main vs off, share %) | `grade-analysis/` | `gradeAnalysis` | `/api/v1/msl/grade-analysis` (`months`, list, `grade/{grade}`) | grades → main/off/elevation totals; elevations → grand total |
| Combined (gross) averages (broker × factory × mark, gross proceeds) | `combined-averages/` | `combinedAverages` | `/api/v1/msl/combined-averages` (`months`, list, `factory/{mfCode}`) | factories → broker total; brokers → grand total |
| Plantation ranking (company rank by elevation, with brokers) | `plantation-ranking/` | `plantationRankings` | `/api/v1/msl/plantation-ranking` (`months`, list, `company/{name}`) | brokers → company; companies → elevation total |

Coverage is only the months that were kept (2018–2020), not a continuous series. Cross-checks between them:
the Feb 2019 grand total is 23,812,675.3 kg in both the grade analysis and the combined averages, and
2018-12's combined broker totals (18,705,415.2 kg) equal the factory-averages grand total for December 2018.

### Rebuilt legacy files

The 2018 originals (and a few 2019 ones) are PDFs. They were read by position (words clustered into rows by
height, figures assigned to columns by their edge, fragments a PDF writer split — `2` + `7,440,571` — rejoined) and
rewritten as standard-layout text reports beside the PDF (`derived_from` in the manifest). Verification, all
independent of the reader itself: on three months that exist as both a PDF and a clean text report the rebuild
matched every cell; every elevation/broker/company total computed from the rebuilt rows matched the printed
total wherever the print was legible (printed totals sometimes lose a leading digit — the computed value is the
correct one); and a factory's year-to-date quantity equals the previous month's plus the month's (22 mismatches in
~65,000 checks, all around Feb–Mar 2018 and Mar/Apr 2019, consistent with restatements in the source).
Known source gaps that the import logs instead of hiding: Jan 2022 Uva High and May 2026 Western High totals in the
factory averages, and Rs 20,000 (of Rs 1.9 bn) for Ceylon Tea Brokers in Oct 2018's combined averages.

## Scope: 2023 onward (as of 27 Sep 2026)

The live system holds **2023 onward only**. Everything older — auction/Tea Board/factory averages 2018–2022 and
the whole of the grade-analysis, combined-averages and plantation-ranking sets (2018–2020) — was moved to
`data/_archive-pre2023/` as plain files and its rows were removed from MongoDB. So the grade-analysis,
combined-averages and plantation-ranking tables and APIs are empty until newer reports are dropped in; the parsers,
tables and endpoints stay in place. The Tea Board reports are likewise 2023+ only (2018–2022 archived). To restore
anything, move it back to the same path under `data/msl/` (see the archive's README).
