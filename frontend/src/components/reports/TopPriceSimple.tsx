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

/** Fills `ncols` columns with region blocks at font size `px`, in reading order, breaking between
 *  rows when a column is full ("(continued)" header + repeated grade label on the next column).
 *  Returns false as soon as content can't fit — real rendered heights (scrollHeight), not an
 *  estimate, so a `true` here means the sheet genuinely fits. */
function pack(host: HTMLElement, regions: SimpleRegion[], ncols: number, px: number): boolean {
  host.replaceChildren();
  host.style.fontSize = `${px}px`;
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
          g.textContent = " ";
        }
        const deal = el("div", styles.deal);
        deal.append(el("div", styles.m, r.mark), el("div", styles.p, r.price));
        row.append(g, deal);
        added.push(row);

        const wasEmpty = cols[ci].childNodes.length === 0;
        added.forEach((a) => cols[ci].appendChild(a));
        if (cols[ci].scrollHeight <= budget + 0.5) {
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

/** Largest font size (px) at which everything fits in `ncols` columns AND no mark breaks
 *  mid-word — or, failing that (scanned all the way to the floor with every fitting size still
 *  splitting some word), the largest size that at least fits, mid-word splits accepted as a last
 *  resort rather than losing rows. `clean` tells the caller which of the two it got. */
function largestFit(host: HTMLElement, regions: SimpleRegion[], ncols: number): { px: number; clean: boolean } | null {
  let dirtyBest: number | null = null;
  for (let px = 16; px >= 5; px -= 0.25) {
    if (!pack(host, regions, ncols, px)) continue;
    if (dirtyBest === null) dirtyBest = px;
    if (!anyMidWordBreak(host)) return { px, clean: true };
  }
  return dirtyBest === null ? null : { px: dirtyBest, clean: false };
}

/** Tries both 6 and 7 columns and picks the best result — a clean (no mid-word split) fit always
 *  wins over a dirty one regardless of font size, since an ugly split matters more than a slightly
 *  smaller page; among same-cleanliness results, the larger font size wins. Only when NEITHER
 *  column count can avoid a split anywhere does the largest font size settle for one. */
function fit(host: HTMLElement, regions: SimpleRegion[]): void {
  const results: { px: number; ncols: number; clean: boolean }[] = [];
  for (const ncols of [6, 7]) {
    const r = largestFit(host, regions, ncols);
    if (r) results.push({ px: r.px, ncols, clean: r.clean });
  }
  const clean = results.filter((r) => r.clean);
  const pool = clean.length ? clean : results;
  const best = pool.length ? pool.reduce((a, b) => (b.px > a.px + 0.01 ? b : a)) : null;
  if (best) pack(host, regions, best.ncols, best.px);
  else pack(host, regions, 7, 5);
  host.dataset.fontPx = String(best?.px ?? 5);
  host.dataset.cols = String(best?.ncols ?? 7);
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
          <h1 className={styles.title}>Top Price Page</h1>
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
