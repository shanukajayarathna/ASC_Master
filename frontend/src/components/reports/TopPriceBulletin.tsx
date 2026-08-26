"use client";

import type { TppBand, TppBulletinPage, TppDensity, TppGradeGroup, TppMeta, TppRegionEntry } from "@/lib/topPricePageExport";
import type { RankedLotRow } from "@/types/api";
import styles from "./TopPriceBulletin.module.css";

/** Ellipsis-truncates the actual string, never CSS (text-overflow/overflow:hidden on .mark is
 *  what caused the vertical glyph-clipping bug under html2canvas — see .mark's own CSS comment).
 *  The full name always stays in the row's title tooltip regardless of truncation here. */
function truncateMark(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : text;
}

function Row({ row, gradeStart, markMaxChars }: { row: RankedLotRow; gradeStart: boolean; markMaxChars: number }) {
  return (
    <div className={styles.row} data-ours={row.isOurs ? "true" : "false"} data-grade-start={gradeStart ? "true" : "false"}>
      <span className={styles.mark} title={`${row.sellingMark} — ${row.broker}${row.buyer ? ` — ${row.buyer}` : ""}`}>
        {truncateMark(row.sellingMark, markMaxChars)}
      </span>
      <span className={styles.grade}>{row.grade}</span>
      {/* A non-breaking space, not an empty string, when not ours — an empty <span> is a flex
          item with no content and no explicit height, so it collapses to 0px tall (confirmed:
          this is exactly what made html2canvas's createPattern throw "canvas element with a
          width or height of 0" — every zero-sized descendant it reported was this span). It
          gives it the same real, font-metric-driven height as a row with "@" in it, with no
          visible difference (no font renders a visible glyph for it). */}
      <span className={styles.at} aria-hidden="true">
        {row.isOurs ? "@" : " "}
      </span>
      <span className={styles.price}>{row.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

/** Precomputes which grade groups need their own block-label row, and which row of each group
 *  is the first (for the grade-start spacing rule) — a pure pass over the array, kept separate
 *  from the JSX-producing map below so that map never has to mutate a captured variable while
 *  rendering. */
function withBlockFlags(grades: TppGradeGroup[], multiBlock: boolean): { grade: TppGradeGroup; showBlock: boolean }[] {
  let lastBlock: string | undefined;
  return grades.map((grade) => {
    const showBlock = multiBlock && grade.block !== lastBlock;
    lastBlock = grade.block;
    return { grade, showBlock };
  });
}

/** One region card — a header bar plus its ranked grades, or an empty placeholder for a region
 *  the workbook had no data for (matches the original's own manual-card fallback: nothing
 *  silently vanishes from the bulletin). The SAME markup renders whether this card lands in a
 *  narrow grid column or gets a wide band's full width — `.body`'s native CSS `columns:` (see
 *  TopPriceBulletin.module.css) is what reflows a wide card's rows into extra columns; nothing
 *  here has to know which it got. */
function Card({ entry, markMaxChars }: { entry: TppRegionEntry; markMaxChars: number }) {
  const cat = entry.category;
  const multiBlock = new Set(cat.grades.map((g) => g.block || "")).size > 1;
  const gradesWithFlags = withBlockFlags(cat.grades, multiBlock);

  return (
    <div className={styles.card} data-card-title={cat.title}>
      <div className={styles.head}>
        <span>{cat.title}</span>
      </div>
      {cat.grades.length === 0 ? (
        <div className={styles.empty}>No ranked lots for this region in the generated report.</div>
      ) : (
        <div className={styles.body}>
          {gradesWithFlags.map(({ grade: g, showBlock }, gi) => (
            <div key={gi}>
              {showBlock && <div className={styles.block}>{g.block || "Other"}</div>}
              {g.rows.map((r, ri) => (
                <Row key={ri} row={r} gradeStart={ri === 0} markMaxChars={markMaxChars} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TopPriceBulletinProps {
  pages: TppBulletinPage[];
  density: TppDensity;
  meta: TppMeta;
  /** Called once per rendered page with its real DOM node, so the caller (the PDF export) can
   *  screenshot each one — see exportTopPricePagePdf's own doc comment. */
  onPageRef?: (el: HTMLDivElement | null, index: number) => void;
}

/** The on-screen executive bulletin — a faithful port of the original standalone tool's own
 *  DOM/CSS (asc-components.css §K2's .asc-tpp-* classes, read directly from the source): a
 *  vertical stack of BANDS per page, each either a narrow 3-column grid of small region cards
 *  (LPT-packed by planTppRegionBandedLayout) or one big region given the full page width to
 *  reflow into its own reading columns via native CSS `columns:`. This is also literally what
 *  gets exported to PDF — exportTopPricePagePdf screenshots each `.page` node captured via
 *  onPageRef, exactly like the original tool's own html2canvas-based export. */
export default function TopPriceBulletin({ pages, density, meta, onPageRef }: TopPriceBulletinProps) {
  const totalPages = pages.length;

  return (
    <div className={styles.bulletin} data-density={density.name}>
      {pages.map((page, pi) => (
        <div key={pi} className={styles.page} ref={(el) => onPageRef?.(el, pi)}>
          <div className={styles.masthead}>
            <div className={styles.mastheadBrand}>
              <dl className={styles.mastheadMeta}>
                <div>
                  <dt>Sale Date</dt>
                  <dd>{meta.saleDate || "Sale date"}</dd>
                </div>
              </dl>
            </div>
            <div>
              <div className={styles.mastheadTitle}>{meta.broker || "Asia Siyaka Commodities PLC"}</div>
              <span className={styles.mastheadSub}>Top Price Page</span>
            </div>
            <div className={styles.mastheadRight}>
              <div>Sale No. {meta.auctionNumber || "—"}</div>
              <div className={styles.mastheadPage}>
                Page {pi + 1} of {totalPages}
              </div>
            </div>
          </div>

          <div className={styles.bands}>
            {page.bands.map((band: TppBand, bi) =>
              band.kind === "wide" ? (
                <div key={bi} data-band="wide">
                  <Card entry={band.entry} markMaxChars={density.markMaxChars} />
                </div>
              ) : (
                <div key={bi} className={styles.regions} data-band="grid">
                  {band.columns
                    .filter((col) => col.length > 0)
                    .map((col, ci) => (
                      <div key={ci} className={styles.regionCol}>
                        {col.map((entry) => (
                          <Card key={entry.title} entry={entry} markMaxChars={density.markMaxChars} />
                        ))}
                      </div>
                    ))}
                </div>
              )
            )}
          </div>

          <div className={styles.footer}>
            <span className={styles.footerRule} aria-hidden="true" />
            <span className={styles.footerCaption}>
              ◆ {[meta.broker || "Asia Siyaka Commodities PLC", "Weekly Top Price Bulletin", `Sale No. ${meta.auctionNumber || "—"}`, meta.saleDate]
                .filter(Boolean)
                .join("   ·   ")}{" "}
              ◆
            </span>
            <span className={styles.footerRule} aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  );
}
