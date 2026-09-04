"use client";

import type { BulletinRow, BulletinSection, BulletinTable, MarketBulletin, PriceRange } from "@/types/api";
import styles from "./MarketBulletinBulletin.module.css";

/** Every table in this bulletin has a FIXED row count by construction (a 4-tier table always
 *  has exactly 4 rows, a 2-tier table always 2, etc. — how many lots actually exist only
 *  changes the numbers inside, never the shape). Confirmed against two real sales a year apart
 *  (Sale 51/2024, Sale 33/2026): identical table/row counts in every section. That means, unlike
 *  Top Price Page's ranked-lot rows (which genuinely vary sale to sale and need a runtime
 *  auto-fit density solver), this bulletin's total content size is constant — one carefully
 *  tuned fixed layout is enough to guarantee it always fits in 2 pages, no solver needed.
 *  Section→page split is balanced by that fixed row budget (66 vs 64 rows), not by topic. */
const PAGE_GROUPS: { sections: string[] }[] = [
  { sections: ["High Grown", "Medium Grown", "Unorthodox", "H&M Orthodox Black Tea"] },
  { sections: ["Off Grades", "Dust", "Low Grown"] },
];

/** Grid column count per section — chosen so each section's own row of cards fills its full
 *  width edge to edge (no auto-fill, which leaves a lopsided gap when a 2-table section sits in
 *  a 4-column track). Off Grades/Dust are 2 columns deliberately: their table order already
 *  interleaves Better/Other per grade so a 2-col grid lines them up as intuitive side-by-side
 *  pairs (Better X | Other X on one row) rather than splitting a pair across rows. */
const SECTION_COLUMNS: Record<string, number> = {
  "High Grown": 2,
  "Medium Grown": 2,
  Unorthodox: 2,
  "H&M Orthodox Black Tea": 3,
  "Off Grades": 2,
  Dust: 2,
  "Low Grown": 5,
};

function extractSaleNumber(sourceName: string): string {
  const m = /Sale\s+(\d+)/i.exec(sourceName);
  return m ? m[1] : sourceName;
}

function formatRange(r: PriceRange): string {
  if (r.lotCount === 0 || r.min === null || r.max === null) return "NA";
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
}

/** Purely numeric — no narrative text, just a directional arrow comparing this week's midpoint
 *  price to last week's, so the reader gets an at-a-glance "dearer/easier" cue the same way the
 *  original bulletin's prose did, without generating any prose of our own. */
function Delta({ row }: { row: BulletinRow }) {
  const { thisWeek: tw, lastWeek: lw } = row;
  if (tw.min === null || tw.max === null || lw.min === null || lw.max === null) return <span className={styles.delta} aria-hidden="true" />;
  const twMid = (tw.min + tw.max) / 2;
  const lwMid = (lw.min + lw.max) / 2;
  if (twMid === lwMid) return <span className={styles.delta} aria-hidden="true" />;
  const up = twMid > lwMid;
  return (
    <span className={`${styles.delta} ${up ? styles.deltaUp : styles.deltaDown}`} title={up ? "Dearer than last week" : "Easier than last week"}>
      {up ? "▲" : "▼"}
    </span>
  );
}

function RangeRow({ row, zebra }: { row: BulletinRow; zebra: boolean }) {
  return (
    <div className={styles.row} data-zebra={zebra ? "true" : "false"}>
      <span className={styles.rowLabel} title={row.label}>
        {row.label}
      </span>
      <span className={`${styles.rowVal} ${styles.rowValThis}`}>{formatRange(row.thisWeek)}</span>
      <Delta row={row} />
      <span className={`${styles.rowVal} ${styles.rowValLast}`}>{formatRange(row.lastWeek)}</span>
    </div>
  );
}

function TableCard({ table }: { table: BulletinTable }) {
  return (
    <div className={styles.table}>
      <div className={styles.tableHead}>
        <span>{table.gradeLabel}</span>
        <span className={styles.tableHeadUnit}>Rs/Kg</span>
      </div>
      <div className={styles.colHead}>
        <span>&nbsp;</span>
        <span>TW</span>
        <span className={styles.colHeadSpacer}>&nbsp;</span>
        <span>LW</span>
      </div>
      {table.rows.map((r, i) => (
        <RangeRow key={i} row={r} zebra={i % 2 === 1} />
      ))}
    </div>
  );
}

function SectionCard({ section }: { section: BulletinSection }) {
  const cols = SECTION_COLUMNS[section.title] ?? 3;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>{section.title}</div>
      {section.tables.length === 0 ? (
        <div className={styles.sectionEmpty}>No matching lots for this section.</div>
      ) : (
        <div className={styles.tableGrid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {section.tables.map((t, i) => (
            <TableCard key={i} table={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface MarketBulletinBulletinProps {
  bulletin: MarketBulletin;
  /** Called once per rendered page with its real DOM node, for PDF export — see
   *  marketBulletinExport.ts's exportMarketBulletinPdf. */
  onPageRef?: (el: HTMLDivElement | null, index: number) => void;
}

export default function MarketBulletinBulletin({ bulletin, onPageRef }: MarketBulletinBulletinProps) {
  const byTitle = new Map(bulletin.sections.map((s) => [s.title, s]));
  const saleNo = extractSaleNumber(bulletin.sourceName);
  const prevSaleNo = bulletin.previousSourceName ? extractSaleNumber(bulletin.previousSourceName) : null;

  return (
    <div className={styles.bulletin}>
      {PAGE_GROUPS.map((group, pi) => {
        const sections = group.sections.map((t) => byTitle.get(t)).filter((s): s is BulletinSection => Boolean(s));
        if (sections.length === 0) return null;
        return (
          <div key={pi} className={styles.page} ref={(el) => onPageRef?.(el, pi)}>
            {/* Masthead mirrors Top Price Page's own exactly: brand name as the title, report
                name as the gold subtitle, sale date on the left, sale number on the right —
                same layout, same colors, same typography as TopPriceBulletin.tsx. */}
            <div className={styles.masthead}>
              <dl className={styles.mastheadMeta}>
                <div>
                  <dt>Sale Date</dt>
                  <dd>{bulletin.sourceName}</dd>
                </div>
              </dl>
              <div>
                <div className={styles.mastheadTitle}>Asia Siyaka Commodities PLC</div>
                <span className={styles.mastheadSub}>Weekly Market Bulletin</span>
              </div>
              <div className={styles.mastheadRight}>
                <div>Sale No. {saleNo}</div>
                {prevSaleNo && <div className={styles.mastheadRightSub}>cf. Sale {prevSaleNo}</div>}
              </div>
            </div>

            <div className={styles.sections}>
              {sections.map((s, si) => (
                <SectionCard key={si} section={s} />
              ))}
            </div>

            <div className={styles.footer}>
              <span className={styles.footerRule} aria-hidden="true" />
              <span className={styles.footerCaption}>
                &#9670; {["Asia Siyaka Commodities PLC", `Sale No. ${saleNo}`, `Page ${pi + 1} of ${PAGE_GROUPS.length}`].join("   ·   ")} &#9670;
              </span>
              <span className={styles.footerRule} aria-hidden="true" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
