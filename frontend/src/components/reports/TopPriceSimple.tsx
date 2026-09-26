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

/** "MULATIYANA HILLS" -> "Mulatiyana Hills", "MISTY-UVA" -> "Misty-Uva", "DEMODERA 'S'" keeps 'S'. */
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
    .replace(/'s'/g, "'S'");
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

/** Largest font size (px) at which everything fits in `ncols` columns, or null. */
function largestFit(host: HTMLElement, regions: SimpleRegion[], ncols: number): number | null {
  for (let px = 16; px >= 5; px -= 0.25) if (pack(host, regions, ncols, px)) return px;
  return null;
}

/** 6 columns unless that would push text below ~7.5px, in which case 7 is tried and the larger
 *  resulting size wins; a sale too dense for either falls back to 7 columns at the 5px floor. */
function fit(host: HTMLElement, regions: SimpleRegion[]): void {
  let best: { px: number; ncols: number } | null = null;
  for (const ncols of [6, 7]) {
    const px = largestFit(host, regions, ncols);
    if (px !== null && (!best || px > best.px + 0.01)) {
      best = { px, ncols };
      if (px >= 7.5) break;
    }
  }
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
