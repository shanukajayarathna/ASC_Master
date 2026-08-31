"use client";

import type { TppBulletinPage, TppDensity, TppGradeGroup, TppMeta, TppRegionEntry } from "@/lib/topPricePageExport";
import type { RankedLotRow } from "@/types/api";
import type { CSSProperties } from "react";
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

/** One region section — a full-page-width header bar plus its ranked grades, or an empty
 *  placeholder for a region the workbook had no data for (nothing silently vanishes from the
 *  bulletin). `internalCols` (see topPricePageExport.ts's spanColsForRegion) is how many of its
 *  OWN internal reading columns this section's rows reflow into, sized to its OWN row count —
 *  reflowed via native CSS `column-count`, exactly matching the column width `markMaxChars` (also
 *  passed in, computed for that same column count) already assumed. `gradeBasisPx` overrides
 *  `--tpp-grade-basis` on this card alone (a CSS custom property cascades to any descendant that
 *  doesn't set its own) — only a region whose own longest grade code needs more room than the
 *  shared density default gets a wider `.grade` column, so one long code elsewhere on the page
 *  never steals Selling Mark width from every OTHER region too (see topPricePageExport.ts's
 *  gradeBasisFor). */
function Card({
  entry,
  markMaxChars,
  internalCols,
  gradeBasisPx,
}: {
  entry: TppRegionEntry;
  markMaxChars: number;
  internalCols: number;
  gradeBasisPx: number;
}) {
  const cat = entry.category;
  const multiBlock = new Set(cat.grades.map((g) => g.block || "")).size > 1;
  const gradesWithFlags = withBlockFlags(cat.grades, multiBlock);

  return (
    <div className={styles.card} data-card-title={cat.title} style={{ "--tpp-grade-basis": `${gradeBasisPx}px` } as CSSProperties}>
      <div className={styles.head}>
        <span>{cat.title}</span>
      </div>
      {cat.grades.length === 0 ? (
        <div className={styles.empty}>No ranked lots for this region in the generated report.</div>
      ) : (
        <div className={styles.body} style={internalCols > 1 ? { columnCount: internalCols, columnGap: "var(--tpp-grid-gap)" } : undefined}>
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

/** Every density.css field as an inline CSS custom property, consumed directly by the base rules
 *  in TopPriceBulletin.module.css — there are no discrete `[data-density="x"]` breakpoints to
 *  keep in sync: planTppBulletinAutoFit solves a continuous `t` per sale (topPricePageExport.ts),
 *  and every rendered pixel here follows that exact number, not a nearest-bucket approximation. */
function densityCssVars(density: TppDensity): CSSProperties {
  const c = density.css;
  return {
    "--tpp-head-pad-v": `${c.headPadV}px`,
    "--tpp-head-pad-h": `${c.headPadH}px`,
    "--tpp-head-font-size": `${c.headFontSize}px`,
    "--tpp-block-pad-v": `${c.blockPadV}px`,
    "--tpp-block-pad-h": `${c.blockPadH}px`,
    "--tpp-block-margin-top": `${c.blockMarginTop}px`,
    "--tpp-block-font-size": `${c.blockFontSize}px`,
    "--tpp-row-gap": `${c.rowGap}px`,
    "--tpp-row-pad-v": `${c.rowPadV}px`,
    "--tpp-row-pad-h": `${c.rowPadH}px`,
    "--tpp-row-font-size": `${c.rowFontSize}px`,
    "--tpp-row-line-height": `${c.rowLineHeight}`,
    "--tpp-grade-start-margin-top": `${c.gradeStartMarginTop}px`,
    "--tpp-grade-basis": `${c.gradeBasis}px`,
    "--tpp-grade-font-size": `${c.gradeFontSize}px`,
    "--tpp-at-basis": `${c.atBasis}px`,
    "--tpp-price-basis": `${c.priceBasis}px`,
    "--tpp-price-font-size": `${c.priceFontSize}px`,
    "--tpp-ours-pad-left": `${c.oursPadLeft}px`,
    "--tpp-masthead-pad-v": `${c.mastheadPadV}px`,
    "--tpp-masthead-pad-h": `${c.mastheadPadH}px`,
    "--tpp-masthead-meta-font-size": `${c.mastheadMetaFontSize}px`,
    "--tpp-masthead-title-font-size": `${c.mastheadTitleFontSize}px`,
    "--tpp-masthead-sub-font-size": `${c.mastheadSubFontSize}px`,
    "--tpp-masthead-right-font-size": `${c.mastheadRightFontSize}px`,
    "--tpp-masthead-page-font-size": `${c.mastheadPageFontSize}px`,
    "--tpp-footer-margin-top": `${c.footerMarginTop}px`,
    "--tpp-footer-pad-top": `${c.footerPadTop}px`,
    "--tpp-footer-caption-font-size": `${c.footerCaptionFontSize}px`,
    "--tpp-grid-gap": `${c.gridGap}px`,
  } as CSSProperties;
}

/** The on-screen executive bulletin — a vertical stack of full-page-width region sections per
 *  page (planTppBulletinAutoFit/planTppFullWidthLayout in topPricePageExport.ts), each reflowing
 *  its own rows into however many of its own internal columns suit its own row count — never
 *  split into page-wide side-by-side card columns (see that file's own header comment for why
 *  that was tried and rejected). This is also literally what gets exported to PDF —
 *  exportTopPricePagePdf screenshots each `.page` node captured via onPageRef. */
export default function TopPriceBulletin({ pages, density, meta, onPageRef }: TopPriceBulletinProps) {
  return (
    <div className={styles.bulletin} data-density={density.name} style={densityCssVars(density)}>
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
            </div>
          </div>

          <div className={styles.sections}>
            {page.sections.map((s, si) => (
              <Card key={si} entry={s.entry} markMaxChars={s.markMaxChars} internalCols={s.spanCols} gradeBasisPx={s.gradeBasisPx} />
            ))}
          </div>

          <div className={styles.footer}>
            <span className={styles.footerRule} aria-hidden="true" />
            <span className={styles.footerCaption}>
              ◆ {[meta.broker || "Asia Siyaka Commodities PLC", "Weekly Top Price", `Sale No. ${meta.auctionNumber || "—"}`, meta.saleDate]
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
