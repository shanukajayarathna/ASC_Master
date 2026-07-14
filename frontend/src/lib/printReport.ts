import { formatCurrency } from "@/lib/format";
import type { Lot } from "@/types/api";

function effectiveValue(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle !== null) return v.valuationSingle;
  if (v.valuationFrom !== null && v.valuationTo !== null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  SelectBest: "Select Best",
  Best: "Best",
  BelowBest: "Below Best",
  Poor: "Poor",
  Unclassified: "—",
};

function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Opens a new browser tab with a branded, print-ready lot report and triggers the browser's
 * print dialog — "Save as PDF" in that dialog is how this becomes a PDF. Building a true
 * server-side PDF would mean a new backend dependency; this reuses what every browser already
 * has and produces the same professional letterhead + table.
 */
export function printLotsReport(lots: Lot[], catalogueName: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;

  const rows = lots
    .map((l) => {
      const value = effectiveValue(l);
      return `<tr>
        <td class="mono">${esc(l.lotNumber)}</td>
        <td>${esc(l.broker)}</td>
        <td>${esc(l.grade)}</td>
        <td>${esc(l.garden ?? l.mark)}</td>
        <td>${esc(l.category)}</td>
        <td class="num">${l.netWeight ?? ""}</td>
        <td class="num mono">${formatCurrency(value)}</td>
        <td>${CLASSIFICATION_LABEL[l.valuation?.classification ?? "Unclassified"]}</td>
        <td>${esc(l.valuation?.standardData)}</td>
        <td>${esc(l.valuation?.liquorRemarks)}</td>
      </tr>`;
    })
    .join("");

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ASC Tea Auction Lot Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1B1712; margin: 0; padding: 28px 32px; }
  .letterhead { border-bottom: 3px solid #AD7F27; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end; }
  .logo { height: 52px; display: block; }
  .brand-sub { font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: #8A7F6C; margin-top: 6px; }
  .meta { text-align: right; font-size: 11.5px; color: #8A7F6C; font-family: 'Courier New', monospace; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { background: #AD7F27; color: #fff; text-align: left; padding: 6px 7px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 5px 7px; border-bottom: 1px solid #E7DCC2; vertical-align: top; }
  td.mono, th.mono { font-family: 'Courier New', monospace; }
  td.num { text-align: right; }
  tr:nth-child(even) td { background: #FAF6EC; }
  .footer { margin-top: 16px; font-size: 9.5px; color: #8A7F6C; text-align: center; }
  @media print { body { padding: 12px 16px; } }
</style>
</head>
<body>
  <div class="letterhead">
    <div>
      <img class="logo" src="${window.location.origin}/brand/asia-siyaka.png" alt="Asia Siyaka Commodities PLC">
      <div class="brand-sub">Tea Auction Valuation &amp; Business Intelligence</div>
    </div>
    <div class="meta">
      Generated ${new Date().toLocaleString()}<br>
      ${lots.length.toLocaleString()} lot(s)
    </div>
  </div>
  <h1>Tea Auction Lot Report — ${esc(catalogueName)}</h1>
  <table>
    <thead>
      <tr>
        <th class="mono">Lot No</th><th>Broker</th><th>Grade</th><th>Garden / Mark</th><th>Category</th>
        <th class="num">Net Wt (kg)</th><th class="num">Valuation</th><th>Classification</th><th>Standard Data</th><th>Liquor Remarks</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">Asia Siyaka Commodities — confidential, for internal broker use only.</p>
</body>
</html>`);
  win.document.close();
  win.focus();
  // Wait for the letterhead logo before printing (with a fallback so a failed image
  // load can never block the dialog).
  const logo = win.document.images[0];
  const printOnce = (() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      win.print();
    };
  })();
  if (logo && !logo.complete) {
    logo.addEventListener("load", () => setTimeout(printOnce, 50));
    logo.addEventListener("error", printOnce);
    setTimeout(printOnce, 1500);
  } else {
    setTimeout(printOnce, 300);
  }
}
