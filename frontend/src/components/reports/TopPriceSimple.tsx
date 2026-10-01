"use client";

import type { TppMeta, TppRegionEntry } from "@/lib/topPricePageExport";
import { useLayoutEffect, useMemo, useRef } from "react";
import styles from "./TopPriceSimple.module.css";

const CTC_LABEL = new Map<string, string>([
  ["WH", "Western High"],
  ["WM", "Western Medium"],
  ["L", "Low Grown"],
]);

interface SimpleRow {
  grade: string;
  sub: string;
  first: boolean;
  mark: string;
  price: string;
  ours: boolean;
}
interface SimpleRegion {
  name: string;
  rows: SimpleRow[];
}

/** "MULATIYANA HILLS" -> "Mulatiyana Hills", "MISTY-UVA" -> "Misty-Uva", "DEMODERA 'S'" keeps 'S',
 *  and CTC (the tea type, an acronym) always stays fully capitalised: "KALUBOWITIYANA CTC". */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) =>
      w
        .split("-")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join("-")
    )
    .join(" ")
    .replace(/'s'/g, "'S'")
    .replace(/\bctc\b/gi, "CTC");
}

/** Flattens the same ranked regions the detailed bulletin renders (buildRegionEntries already
 *  dedupes same-mark/same-price rows and sorts highest first) into plain rows for this layout.
 *  Regions with no ranked rows are dropped — a one-page simple sheet has no room for empty
 *  placeholder blocks. */
function toRegions(entries: TppRegionEntry[]): SimpleRegion[] {
  return entries
    .filter((e) => e.category.grades.some((g) => g.rows.length > 0))
    .map((e) => {
      const isCtc = e.category.title === "CTC Teas";
      const rows: SimpleRow[] = [];
      for (const g of e.category.grades) {
        const sub = isCtc ? (CTC_LABEL.get(g.block.toUpperCase()) ?? g.block) : "";
        g.rows.forEach((r, i) =>
          rows.push({
            grade: g.grade,
            sub,
            first: i === 0,
            mark: titleCase(r.sellingMark),
            price: r.price.toLocaleString("en-US", { maximumFractionDigits: 2 }),
            ours: r.isOurs,
          })
        );
      }
      return { name: e.category.title, rows };
    });
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** How much of `col`'s own real content is actually filled, top to bottom — NOT `col.scrollHeight`,
 *  which is useless for this: `.cols` is a flex row with the default `align-items: stretch`, so
 *  EVERY `.col` (even a completely empty one) is stretched to the full column height regardless of
 *  content, and `scrollHeight` reports whichever is larger of that stretched box or the real
 *  content — for any column under budget, that's always the stretched box, not the content. This
 *  instead reads the real bottom edge of the column's own last child. */
function realColHeight(col: HTMLElement): number {
  const last = col.lastElementChild;
  if (!last) return 0;
  return last.getBoundingClientRect().bottom - col.getBoundingClientRect().top;
}

/** Font size the widest real grade code/CTC elevation label is measured at (measureGradeRefWidth)
 *  — arbitrary but large enough that sub-pixel rounding in the measurement doesn't meaningfully
 *  skew the width `pack` later scales down to the actual `px` in play (text width scales linearly
 *  with font size for a given string, so one measurement at a big reference size covers every
 *  candidate size the fit search tries). */
const GRADE_REF_PX = 100;

/** How much horizontal padding beyond the raw measured text width `.g`'s column gets — covers
 *  `.g`'s own box-model rounding and keeps the grade code from sitting flush against the column
 *  edge (matches the visual breathing room the old flat 15.5mm gave short codes, without paying
 *  for it on every row regardless of how short THIS sale's codes actually are). */
const GRADE_WIDTH_PAD = 7;

/** The real rendered width (in px, at GRADE_REF_PX) of THIS sale's single longest grade code or
 *  CTC elevation sub-label (whichever needs more room) — measured directly with a throwaway
 *  offscreen span rather than estimated from character count, since a proportional font's glyph
 *  widths vary too much per-character for a flat ratio to size the column without either clipping
 *  a wide code (letters like F/P/W run wider than a ratio tuned for the average) or wasting room
 *  padding for one that never occurs in this sale's own data. `pack` scales this down linearly to
 *  whatever `px` it's actually trying, so this only needs computing ONCE per sale, not once per
 *  candidate font size — the codes/labels rendered don't change, only their size does. Considers
 *  the sub-label (`.g small`, 0.72em/weight 400) alongside the grade code (full size/weight 700)
 *  since a CTC region's "Western Medium" can need more room than any grade code in the sale. */
function measureGradeRefWidth(regions: SimpleRegion[]): number {
  const span = document.createElement("span");
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  span.style.whiteSpace = "nowrap";
  span.style.fontFamily = "'Segoe UI', Arial, Helvetica, sans-serif";
  document.body.appendChild(span);

  const grades = new Set<string>();
  const subs = new Set<string>();
  for (const reg of regions)
    for (const r of reg.rows) {
      grades.add(r.grade);
      if (r.sub) subs.add(r.sub);
    }

  const measure = (text: string, fontWeight: number, relSize: number) => {
    span.style.fontWeight = String(fontWeight);
    span.style.fontSize = `${GRADE_REF_PX * relSize}px`;
    span.textContent = text;
    return span.getBoundingClientRect().width;
  };
  let widest = 0;
  for (const g of grades) widest = Math.max(widest, measure(g, 700, 1));
  for (const s of subs) widest = Math.max(widest, measure(s, 400, 0.72));

  document.body.removeChild(span);
  return widest;
}

/** Fills `ncols` columns with region blocks at font size `px`, in reading order, breaking between
 *  rows when a column is full ("(continued)" header + repeated grade label on the next column).
 *  `cap`, when given, makes this BALANCE instead of greedily filling each column to the budget
 *  before moving on: a non-empty column advances to the next one as soon as its own real content
 *  reaches `cap`, and — unlike the page's hard `budget` — `cap` applies to EVERY column, including
 *  the last, so content that still doesn't fit in `ncols` columns at this `cap` is a real failure
 *  (returns false) rather than silently spilling into the last column regardless of `cap`. That's
 *  what lets `packBalanced` below binary-search for the smallest `cap` that still fits everything
 *  in `ncols` columns: at that tightest feasible `cap`, no column can be far short of it, because a
 *  meaningfully shorter one would mean `cap` still had room to spare and a smaller `cap` would have
 *  been feasible too — see packBalanced's own comment for why a single flat `total/ncols` guess
 *  (this function's own previous behaviour) doesn't have that property and left a real sale's last
 *  column 42px shorter than its neighbours. Returns false as soon as content can't fit at all (even
 *  the hard `budget`) — real rendered heights, not an estimate, so a `true` here means the sheet
 *  genuinely fits. `gradeRefW`, when given, sets `.g`'s width (via the `--grade-w` custom property
 *  `.g` reads) to that sale's own real grade-column need at this `px` — see measureGradeRefWidth. */
function pack(host: HTMLElement, regions: SimpleRegion[], ncols: number, px: number, cap?: number, gradeRefW?: number): boolean {
  host.replaceChildren();
  host.style.fontSize = `${px}px`;
  if (gradeRefW !== undefined) {
    host.style.setProperty("--grade-w", `${Math.ceil((gradeRefW * px) / GRADE_REF_PX + GRADE_WIDTH_PAD)}px`);
  }
  const cols: HTMLElement[] = [];
  for (let i = 0; i < ncols; i++) {
    const c = el("div", styles.col);
    host.appendChild(c);
    cols.push(c);
  }
  const budget = host.clientHeight;
  let ci = 0;
  for (const reg of regions) {
    let needHeader = true;
    for (let i = 0; i < reg.rows.length; i++) {
      const r = reg.rows[i];
      for (;;) {
        if (cap !== undefined && cols[ci].childNodes.length > 0 && realColHeight(cols[ci]) >= cap) {
          ci++;
          if (ci >= ncols) return false;
          needHeader = true;
          continue;
        }
        const added: HTMLElement[] = [];
        if (needHeader) {
          const h = el("div", styles.rh);
          h.append(reg.name);
          if (i > 0) h.append(" ", el("small", undefined, "(continued)"));
          added.push(h);
        }
        const repeatGrade = needHeader && i > 0 && !r.first;
        const showGrade = r.first || repeatGrade;
        const row = el("div", [styles.row, r.first && !repeatGrade ? styles.gs : "", r.ours ? styles.ours : ""].filter(Boolean).join(" "));
        const g = el("div", styles.g);
        if (showGrade) {
          g.append(r.grade);
          if (r.sub) g.append(el("small", undefined, r.sub));
        } else {
          g.textContent = " ";
        }
        const deal = el("div", styles.deal);
        // Same "@" marker as the Detailed bulletin's own .at span (TopPriceBulletin.tsx) — shown
        // only on ASC's own sold rows, right before the price. A space (never an empty string) on
        // every other row keeps this cell's real rendered height identical whether or not it holds
        // a glyph, so it can't skew realColHeight's row-height measurement between ASC and plain rows.
        deal.append(el("div", styles.m, r.mark), el("div", styles.at, r.ours ? "@" : " "), el("div", styles.p, r.price));
        row.append(g, deal);
        added.push(row);

        const wasEmpty = cols[ci].childNodes.length === 0;
        added.forEach((a) => cols[ci].appendChild(a));
        if (realColHeight(cols[ci]) <= budget + 0.5) {
          needHeader = false;
          break;
        }
        added.forEach((a) => cols[ci].removeChild(a));
        if (wasEmpty) return false;
        ci++;
        if (ci >= ncols) return false;
        needHeader = true;
      }
    }
  }
  return true;
}

/** Packs once plainly (greedy — fills each column to the budget before moving to the next) purely
 *  to learn the REAL total content height at this px/ncols (the sum of every column's own real
 *  content — the same number regardless of how it happens to be distributed across columns), then
 *  packs again with that total spread evenly as a flat per-column cap. Cheap (one extra `pack`
 *  call) but only approximately even — good enough to RANK candidate sizes/column-counts against
 *  each other during `fit`'s own sweep (tried up to ~180 times), which is all this is used for; the
 *  actually-rendered result uses `packTightlyBalanced` below instead, once, on the winning
 *  candidate only. A flat guess isn't perfectly even because `pack`'s cap check only fires AFTER a
 *  row is added, so every column ends up cap-or-a-row over, and that overshoot compounds forward —
 *  fine for ranking (the error is consistent across candidates), not for what actually ships. */
function packBalanced(host: HTMLElement, regions: SimpleRegion[], ncols: number, px: number, gradeRefW?: number): boolean {
  if (!pack(host, regions, ncols, px, undefined, gradeRefW)) return false;
  const total = Array.from(host.children).reduce((sum, col) => sum + realColHeight(col as HTMLElement), 0);
  if (total <= 0) return true;
  return pack(host, regions, ncols, px, total / ncols, gradeRefW);
}

/** The precise version of the balance above — binary-searches `pack`'s own `cap` for the SMALLEST
 *  value that still fits everything in `ncols` columns, rather than one flat `total/ncols` guess.
 *  Used ONCE, on `fit`'s final winning (ncols, px), for the sheet that's actually rendered — NOT
 *  during the sweep that picks that winner (packBalanced above), because this costs ~24x a single
 *  pack: confirmed directly, running this per candidate during the sweep took a real sale from
 *  ~1.8s to ~91s. A flat guess is uneven for the same reason noted above (`pack`'s cap only fires
 *  after a row is added, so the overshoot compounds forward, all landing on the LAST column, which
 *  has nothing after it to make it up) — confirmed directly on a real sale, where the flat guess
 *  left the last column 42px shorter than its neighbours (605px against 641-647px). The binary
 *  search instead finds the tightest cap the content can be squeezed into `ncols` columns at all:
 *  any real column meaningfully short of THAT cap would mean the cap had spare room to give, which
 *  would make an even smaller cap feasible too — contradicting it being the smallest one found. 14
 *  steps of a search starting from a `total/ncols`-to-`budget` range converges to sub-pixel
 *  precision; paid once per render, not per sweep candidate, this stays cheap. */
function packTightlyBalanced(host: HTMLElement, regions: SimpleRegion[], ncols: number, px: number, gradeRefW?: number): boolean {
  if (!pack(host, regions, ncols, px, undefined, gradeRefW)) return false;
  const total = Array.from(host.children).reduce((sum, col) => sum + realColHeight(col as HTMLElement), 0);
  if (total <= 0) return true;

  let lo = total / ncols;
  let hi = host.clientHeight;
  for (let i = 0; i < 14 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (pack(host, regions, ncols, px, mid, gradeRefW)) hi = mid;
    else lo = mid;
  }
  return pack(host, regions, ncols, px, hi, gradeRefW);
}

/** Whether any mark in the just-packed host had to break WITHIN a word — overflow-wrap:anywhere
 *  (the `.m` rule) stops overlap, but it breaks at the exact pixel where a word stops fitting,
 *  which can just as easily land after 12 of 14 characters as after 7, leaving a stray 2-character
 *  fragment like "na" alone on its own line ("Kalubowitiyana" -> "Kalubowitiya" / "na") — confirmed
 *  directly on real data (Range.getClientRects: a single word spanning more than one distinct
 *  `top` means it broke mid-word). That's ugly even though it's not technically an overflow, so
 *  `largestFit` below treats "fits AND wraps cleanly" as the real target and only accepts a
 *  mid-word split as a last resort when no size/column combination avoids one. */
function anyMidWordBreak(host: HTMLElement): boolean {
  const marks = host.querySelectorAll(`.${styles.m}`);
  for (const markEl of Array.from(marks)) {
    const textNode = markEl.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const text = textNode.textContent ?? "";
    const wordPattern = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(text))) {
      const range = document.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      if (tops.size > 1) return true;
    }
  }
  return false;
}

/** How much blank room is left under the SHORTEST column at the size/column-count `host` was just
 *  packed at, against the page budget — not the tallest column's own shortfall. `fit`'s final
 *  alignment step (below) always stretches every column's box up to the TALLEST column's real
 *  height, so once that runs, the shortest column's own blank space is exactly what becomes
 *  visible: a column-shaped gap of empty space below its last real row, looking like a mistake
 *  rather than a page that's merely not 100% full (confirmed directly: a candidate whose tallest
 *  column used 647 of a 653 budget still put a 42px visible gap under its shortest column, because
 *  only the tallest column's own fullness was being checked here before). Checking the tallest
 *  column alone can't see that — two columns can be equally "nearly full at the top" while one of
 *  them is dramatically shorter than the other. */
function blankOf(host: HTMLElement): number {
  const budget = host.clientHeight;
  const cols = Array.from(host.children) as HTMLElement[];
  const heights = cols.map((c) => realColHeight(c));
  return budget - (heights.length ? Math.min(...heights) : 0);
}

/** Two fit candidates only really differ when the gap between how much blank space each leaves
 *  behind is bigger than about a row's worth (a couple of these sales' rows land within ~10-15px
 *  of each other in real measurements) — below that, it's noise from the same discrete rows
 *  landing slightly differently across columns, not a real difference in how well either uses the
 *  page, so the larger, more readable font wins instead. Above it, real unused room matters more
 *  than a marginally bigger font. */
const BLANK_TOLERANCE_PX = 15;
function pickFitter<T extends { px: number; blank: number }>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => {
    if (b.blank < a.blank - BLANK_TOLERANCE_PX) return b;
    if (a.blank < b.blank - BLANK_TOLERANCE_PX) return a;
    return b.px > a.px ? b : a;
  });
}

/** Largest-font-with-least-blank-space fit in `ncols` columns AND no mark breaking mid-word — or,
 *  failing that (scanned all the way to the floor with every fitting size still splitting some
 *  word), the fitting size with the least blank space, mid-word splits accepted as a last resort
 *  rather than losing rows. `clean` tells the caller which of the two it got. Sweeps the WHOLE
 *  range rather than stopping at the first size that fits: a slightly smaller font sometimes packs
 *  noticeably tighter than the largest one that still technically fits, because rows only ever
 *  move between columns in whole units — one row tipping over a column's budget can cascade and
 *  leave a later column with real room to spare, which a bigger nearby size doesn't. */
function largestFit(host: HTMLElement, regions: SimpleRegion[], ncols: number, gradeRefW: number): { px: number; blank: number; clean: boolean } | null {
  let bestClean: { px: number; blank: number } | null = null;
  let bestDirty: { px: number; blank: number } | null = null;
  for (let px = 16; px >= 5; px -= 0.25) {
    if (!packBalanced(host, regions, ncols, px, gradeRefW)) continue;
    const blank = blankOf(host);
    if (!anyMidWordBreak(host)) {
      const candidate = { px, blank };
      bestClean = pickFitter(bestClean ? [bestClean, candidate] : [candidate]);
      // Already using the page about as fully as makes any visible difference — no need to keep
      // scanning smaller sizes purely to shave off a few more px of blank space.
      if (bestClean && bestClean.blank < 3) break;
    } else if (!bestDirty) {
      bestDirty = { px, blank };
    }
  }
  if (bestClean) return { ...bestClean, clean: true };
  return bestDirty ? { ...bestDirty, clean: false } : null;
}

/** Tries several column counts and picks the result that leaves the least blank space on the
 *  page (within `BLANK_TOLERANCE_PX`, where the larger font wins instead) — a clean (no mid-word
 *  split) fit always wins over a dirty one regardless of fill, since an ugly split matters more
 *  than a slightly emptier page. Column count alone can swing how evenly a sale's rows divide up
 *  far more than font size does: real sales measured leaving 100+px of a ~650px-tall column empty
 *  at 6 or 7 columns, when 5 columns fit the exact same content with room to spare. */
function fit(host: HTMLElement, regions: SimpleRegion[]): void {
  const gradeRefW = measureGradeRefWidth(regions);
  const results: { px: number; ncols: number; clean: boolean; blank: number }[] = [];
  for (const ncols of [5, 6, 7, 8]) {
    const r = largestFit(host, regions, ncols, gradeRefW);
    if (r) results.push({ px: r.px, ncols, clean: r.clean, blank: r.blank });
  }
  const clean = results.filter((r) => r.clean);
  const pool = clean.length ? clean : results;
  const best = pickFitter(pool);
  if (best) packTightlyBalanced(host, regions, best.ncols, best.px, gradeRefW);
  else packTightlyBalanced(host, regions, 7, 5, gradeRefW);
  host.dataset.fontPx = String(best?.px ?? 5);
  host.dataset.cols = String(best?.ncols ?? 7);
  // Lines up every column's bottom edge at one shared line instead of each keeping its own
  // leftover margin — but only up to a small tolerance. A column that's only a few px short of the
  // tallest is real balancing noise (reading-order content rarely divides perfectly even at the
  // tightest feasible cap — see packTightlyBalanced), and stretching it those few px to match looks
  // like alignment. A column that's tens of px short is different: that gap is inherent to this
  // sale's own content at this column count (confirmed directly — no cap, however tight, redistributes
  // it, because reading order forbids moving rows backward into an earlier, already-fuller column),
  // and stretching ITS box open that far doesn't hide that, it just turns a column that legitimately
  // ran out of content into what reads as an obviously broken empty box. Past the tolerance, a
  // column is left at its own real height instead. `.cols` itself no longer stretches its children
  // to fill it (module CSS's own `align-items: flex-start`), so this explicit height is the only
  // thing controlling each column's rendered height now — safe to grow within tolerance, since
  // every column's own content is already <= the tallest column's height.
  const BOTTOM_ALIGN_TOLERANCE_PX = 20;
  const cols = Array.from(host.children) as HTMLElement[];
  const heights = cols.map((c) => realColHeight(c));
  const maxHeight = heights.length ? Math.max(...heights) : 0;
  cols.forEach((c, i) => {
    c.style.height = `${Math.min(maxHeight, heights[i] + BOTTOM_ALIGN_TOLERANCE_PX)}px`;
  });
}

export interface TopPriceSimpleProps {
  entries: TppRegionEntry[];
  meta: TppMeta;
}

/** The simple Top Price Page: everything on ONE landscape A4 sheet (same size as the detailed
 *  bulletin's pages), region blocks flowing across columns. Also rendered, unmodified, by
 *  print/top-price-page/page.tsx when `format=simple` for the server-side PDF export. */
export default function TopPriceSimple({ entries, meta }: TopPriceSimpleProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const regions = useMemo(() => toRegions(entries), [entries]);

  useLayoutEffect(() => {
    if (hostRef.current) fit(hostRef.current, regions);
  }, [regions]);

  const saleLine = [meta.broker, `Sale No. ${meta.auctionNumber || "—"}`, meta.saleDate].filter(Boolean);
  return (
    <div className={styles.wrap} data-format="simple">
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.title}>Top Prices</h1>
          <div className={styles.meta}>
            <b>{meta.broker || "Asia Siyaka Commodities PLC"}</b> &nbsp;·&nbsp; Sale No. {meta.auctionNumber || "—"} &nbsp;·&nbsp;{" "}
            <b>{meta.saleDate}</b>
            <span className={styles.sub}>Rs per Kg &nbsp;·&nbsp; highest first &nbsp;·&nbsp; shaded lines = sold by ASC</span>
          </div>
        </div>
        <div ref={hostRef} className={styles.cols} />
        {regions.length === 0 && <div className={styles.empty}>No ranked lots for this sale yet.</div>}
        <div className={styles.foot}>
          <span>{saleLine.join(" · ")}</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
}
