"use client";

import type { TppBulletinPage, TppDensity, TppGradeGroup, TppMeta, TppRegionEntry } from "@/lib/topPricePageExport";
import type { RankedLotRow } from "@/types/api";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./TopPriceBulletin.module.css";

/** Ellipsis-truncates the actual string, never CSS (text-overflow/overflow:hidden on .mark is
 *  what caused the vertical glyph-clipping bug under html2canvas — see .mark's own CSS comment).
 *  The full name always stays in the row's title tooltip regardless of truncation here. */
function truncateMark(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : text;
}

/** `contLabel` is set by Card's column-break detection below when this row is NOT its grade's own
 *  first row but happens to land at the top of a reflowed column anyway — i.e. its grade group got
 *  split by the native CSS multi-column layout. Without it, that row would show a blank grade cell
 *  and read as an unlabeled orphan at the top of its column; showing "Cont. <grade>" there instead
 *  makes the split explicit. The "ours" highlight only wraps `.deal` (mark → price), not the grade
 *  cell, so the shared grade heading never gets swallowed into a highlighted lot's fill. */
function Row({
  row,
  gradeStart,
  markMaxChars,
  rowKey,
  contLabel,
}: {
  row: RankedLotRow;
  gradeStart: boolean;
  markMaxChars: number;
  rowKey: string;
  contLabel: string | null;
}) {
  return (
    <div className={styles.row} data-ours={row.isOurs ? "true" : "false"} data-grade-start={gradeStart ? "true" : "false"} data-row-key={rowKey}>
      {/* The grade leads the row and is written once per group, on its first row only — every
          following row of the SAME grade repeats a non-breaking space instead of the grade text
          (never an empty string: see the .at span's own comment below for why that would collapse
          to 0px tall under html2canvas), so the shared grade reads as one underlined block heading
          over its rows rather than being echoed on every line. `contLabel`'s "Cont. <grade>" text
          renders in-flow, on one line — planTppFullWidthLayout (topPricePageExport.ts) already
          widens this section's own grade column to fit it whenever the section can reflow into
          more than one internal column, so it never wraps or grows this row's own height. */}
      <span className={styles.grade} data-grade-start={gradeStart ? "true" : "false"} data-cont={contLabel ? "true" : "false"}>
        {gradeStart ? row.grade : contLabel ?? " "}
      </span>
      <div className={styles.deal} data-ours={row.isOurs ? "true" : "false"}>
        <span className={styles.mark} title={`${row.sellingMark} — ${row.broker}${row.buyer ? ` — ${row.buyer}` : ""}`}>
          {truncateMark(row.sellingMark, markMaxChars)}
        </span>
        {/* A non-breaking space, not an empty string, when not ours — an empty <span> is a flex
            item with no content and no explicit height, so it collapses to 0px tall (confirmed:
            this is exactly what made html2canvas's createPattern throw "canvas element with a
            width or height of 0" — every zero-sized descendant it reported was this span). It
            gives it the same real, font-metric-driven height as a row with "@" in it, with no
            visible difference (no font renders a visible glyph for it). */}
        <span className={styles.at} aria-hidden="true">
          {row.isOurs ? "@" : " "}
        </span>
        <span className={styles.price}>{row.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
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
  const bodyRef = useRef<HTMLDivElement>(null);

  /** Native `column-count` (set below) reflows rows across columns purely by document order and
   *  measured height — there's no data-layer signal for where a column actually breaks, so it can
   *  land in the middle of a grade group (whose grade text, per Row above, is only ever written on
   *  that group's OWN first row). After layout, walk every row left-to-right in DOM order and flag
   *  any row whose `offsetLeft` jumped to a new column while it is NOT its grade's first row — that
   *  row is a mid-group continuation, and gets a "Cont. <grade>" label instead of a blank cell. Runs
   *  in useLayoutEffect (not useEffect) so the flag lands before paint — the PDF export route
   *  (pdfRender.ts) already waits 150ms past `fonts.ready` for exactly this kind of post-mount pass. */
  const [contKeys, setContKeys] = useState<Set<string>>(() => new Set());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || internalCols <= 1) {
      setContKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-row-key]"));
    let prevLeft: number | null = null;
    const next = new Set<string>();
    for (const el of rows) {
      const left = el.offsetLeft;
      if (prevLeft !== null && left > prevLeft + 1 && el.dataset.gradeStart !== "true") {
        next.add(el.dataset.rowKey!);
      }
      prevLeft = left;
    }
    setContKeys(next);
  }, [entry, internalCols, markMaxChars, gradeBasisPx]);

  return (
    <div className={styles.card} data-card-title={cat.title} style={{ "--tpp-grade-basis": `${gradeBasisPx}px` } as CSSProperties}>
      <div className={styles.head}>
        <span>{cat.title}</span>
      </div>
      {cat.grades.length === 0 ? (
        <div className={styles.empty}>No ranked lots for this region in the generated report.</div>
      ) : (
        <div
          ref={bodyRef}
          className={styles.body}
          style={internalCols > 1 ? { columnCount: internalCols, columnGap: "var(--tpp-grid-gap)" } : undefined}
        >
          {gradesWithFlags.map(({ grade: g, showBlock }, gi) => (
            <div key={gi}>
              {showBlock && <div className={styles.block}>{g.block || "Other"}</div>}
              {g.rows.map((r, ri) => {
                const rowKey = `${gi}-${ri}`;
                return (
                  <Row
                    key={ri}
                    row={r}
                    gradeStart={ri === 0}
                    markMaxChars={markMaxChars}
                    rowKey={rowKey}
                    contLabel={contKeys.has(rowKey) ? `Cont. ${r.grade}` : null}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A page's own region cards, purely rendering — the gap between them is controlled entirely by
 *  the parent (TopPriceBulletin's own useLayoutEffect below), not measured or set here, so every
 *  page can share the SAME resolved gap value (see that effect's own comment for why). `elRef` is
 *  how the parent reaches this page's own `.sections` box to measure it. `showFiller` (also the
 *  parent's own call, see its comment) adds one more flex child at the end that absorbs whatever
 *  real room is left below the last card via `flex:1` — no JS sizing needed for the filler itself,
 *  only for deciding whether there's ENOUGH left to bother showing it (TPP_FILLER_MIN_PX). */
function Sections({
  page,
  gapPx,
  showFiller,
  elRef,
}: {
  page: TppBulletinPage;
  gapPx: number;
  showFiller: boolean;
  elRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={elRef} className={styles.sections} style={{ gap: `${gapPx}px` }}>
      {page.sections.map((s, si) => (
        <Card key={si} entry={s.entry} markMaxChars={s.markMaxChars} internalCols={s.spanCols} gradeBasisPx={s.gradeBasisPx} />
      ))}
      {showFiller && <div className={styles.sectionsFiller} aria-hidden="true" />}
    </div>
  );
}

/** Below this much real leftover room (px), AFTER the filler's own leading `gap` is already
 *  accounted for (see the leftover calc below — that subtraction stays; skipping it risks a
 *  negative-height filler forcing `.sections` taller than its fixed grid-track budget, the exact
 *  overflow bug this file has repeatedly had to fix elsewhere), a page's blank space stays plain
 *  rather than showing the tea-leaf filler motif. Just enough to rule out sub-pixel rounding
 *  noise, not a "does this look like a deliberate texture" bar — a much higher bar (40px) was
 *  tried first and back-fired: several real 2026 sales measured with 43-55px of real leftover
 *  still came out BELOW that 40px bar once the leading-gap subtraction ate into it (e.g. 43px
 *  leftover minus an 18px shared gap = 25px, under 40), so the filler never rendered and the
 *  WHOLE strip showed bare instead of partially covered. Lower fixes that directly: any leftover
 *  clearing the leading-gap cost at all now gets at least some visible pattern rather than none. */
const TPP_FILLER_MIN_PX = 4;

export interface TopPriceBulletinProps {
  pages: TppBulletinPage[];
  density: TppDensity;
  meta: TppMeta;
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
 *  that was tried and rejected). Also rendered, unmodified, by print/top-price-page/page.tsx for
 *  the server-side PDF export (a real Chromium print, not a screenshot of this component). */
export default function TopPriceBulletin({ pages, density, meta }: TopPriceBulletinProps) {
  const sectionEls = useRef<(HTMLDivElement | null)[]>([]);
  const [gapPx, setGapPx] = useState(density.gap);
  const [fillerFlags, setFillerFlags] = useState<boolean[]>([]);

  /** Resolves ONE shared gap for every page's `.sections`, using REAL measured DOM heights (not
   *  the JS layout estimate topPricePageExport.ts plans pages from — that estimate is necessarily
   *  approximate, see estimateTppAutoCardHeight's own comments on why, so sizing a fill-gap from
   *  it risked the exact overflow bug the estimate's own safety margin exists to prevent).
   *  Measuring actual rendered card heights here instead can't overflow: a page's `.sections` box
   *  always renders at its full grid-track height regardless of how much of it the cards actually
   *  use, so solving for the gap that fills a page can only ever reach exactly full, never past
   *  it. Shared ACROSS every page (the min of each page's own fill-gap, i.e. capped by whichever
   *  page has the least room to spare) rather than resolved per page independently — an earlier
   *  version filled each page to its own full independently, which safely used up all blank space
   *  but left the gap BETWEEN sections visibly bigger on a lighter page than a fuller one (e.g.
   *  Uva High → CTC Teas noticeably wider than the equivalent gap on page 1), reading as
   *  inconsistent rather than "well aligned." Capping to the tightest page's own fill-gap keeps
   *  every page's rhythm the same; whatever room a lighter page has beyond that shared gap is left
   *  as plain space below its last card instead — the trade-off this app's own users have
   *  consistently preferred once directly compared to unevenly stretched gaps. Never shrinks below
   *  the density's own tuned `gap` (that's the legibility-tuned minimum spacing, a floor).
   *
   *  ALSO decides, per page, whether that leftover room (Sections.tsx's own `showFiller` prop) is
   *  worth showing the decorative tea-leaf filler for (TPP_FILLER_MIN_PX) — computed from the SAME
   *  real measurements in the same pass, since the filler's own leading gap only becomes knowable
   *  once `sharedGap` itself is resolved. */
  useLayoutEffect(() => {
    const measured = sectionEls.current.map((el) => {
      if (!el) return null;
      const cardEls = Array.from(el.children) as HTMLElement[];
      const avail = el.getBoundingClientRect().height;
      const cardsHeight = cardEls.reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
      return { avail, cardsHeight, count: cardEls.length };
    });
    const fillGaps = measured
      .filter((m): m is NonNullable<typeof m> => m != null && m.count > 1)
      .map((m) => (m.avail - m.cardsHeight) / (m.count - 1));
    const sharedGap = fillGaps.length ? Math.max(density.gap, Math.min(...fillGaps)) : density.gap;
    setGapPx(sharedGap);
    // Leftover AFTER the shared gap between every card, MINUS one more gap for the filler's own
    // leading edge (it renders as one more flex child, so it spends a gap getting there too) —
    // still subtracted (skipping it would risk a negative-height filler forcing `.sections`
    // taller than its fixed grid-track budget, the exact overflow bug this whole file has
    // repeatedly had to fix). What changed is TPP_FILLER_MIN_PX itself, not this subtraction —
    // see that constant's own comment for why the bar dropping to near-zero (not the
    // subtraction) is what actually fixes real leftover strips rendering bare.
    const leftovers = measured.map((m) => {
      if (!m || m.count === 0) return 0;
      const usedByGaps = m.count > 1 ? (m.count - 1) * sharedGap : 0;
      return m.avail - m.cardsHeight - usedByGaps - sharedGap;
    });
    setFillerFlags(leftovers.map((l) => l >= TPP_FILLER_MIN_PX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, density]);

  return (
    <div className={styles.bulletin} data-density={density.name} style={densityCssVars(density)}>
      {pages.map((page, pi) => (
        <div key={pi} className={styles.page}>
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

          <Sections page={page} gapPx={gapPx} showFiller={fillerFlags[pi] ?? false} elRef={(el) => (sectionEls.current[pi] = el)} />

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
