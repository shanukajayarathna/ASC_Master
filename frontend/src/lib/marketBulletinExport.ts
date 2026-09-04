import { jsPDF } from "jspdf";

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Screenshots each already-rendered `.page` DOM node (MarketBulletinBulletin.tsx) into a JPEG
 *  and stitches those into a multi-page PDF — same approach as exportTopPricePagePdf
 *  (topPricePageExport.ts): each page's PDF size comes from its own captured pixel dimensions,
 *  not a fixed constant, so the export always matches what actually rendered. JPEG, not PNG, to
 *  keep file size reasonable at a high capture scale. */
export async function exportMarketBulletinPdf(pageElements: HTMLElement[], sourceName: string): Promise<void> {
  if (pageElements.length === 0) throw new Error("No bulletin pages to export — generate the report first.");

  const { default: html2canvas } = await import("html2canvas");
  const CAPTURE_SCALE = 3;
  const JPEG_QUALITY = 0.95;

  // Web fonts must have finished loading before capture, or html2canvas paints whatever the
  // browser falls back to at that instant — same reasoning as exportTopPricePagePdf.
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));

  let doc: jsPDF | null = null;
  for (const el of pageElements) {
    const canvas = await html2canvas(el, { scale: CAPTURE_SCALE, backgroundColor: "#FCFBF8", useCORS: true });
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const wPt = (canvas.width / CAPTURE_SCALE) * (72 / 96);
    const hPt = (canvas.height / CAPTURE_SCALE) * (72 / 96);
    const orientation = wPt > hPt ? "landscape" : "portrait";
    if (!doc) {
      doc = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation });
    } else {
      doc.addPage([wPt, hPt], orientation);
    }
    doc.addImage(dataUrl, "JPEG", 0, 0, wPt, hPt);
  }

  const saleTag = sourceName.match(/\d+/)?.[0] ?? "draft";
  doc!.save(`weekly-market-bulletin-sale-${saleTag}-${dateStamp()}.pdf`);
}
