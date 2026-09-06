/**
 * Server-side Weekly Market Bulletin PDF export via a real headless Chromium print
 * (Playwright's page.pdf(), the same engine behind a browser's own "Print > Save as PDF"),
 * replacing the old client-side html2canvas+jsPDF screenshot approach.
 *
 * Why: html2canvas re-implements text layout/rendering itself rather than delegating to the
 * browser, and on this report's dense flex rows it produced genuinely corrupted output —
 * every row but a table's last rendered visibly clipped/overlapping in the exported PDF, even
 * though the live DOM measured perfectly (every row exactly 12px, zero overlap — confirmed
 * directly via getBoundingClientRect). A native print has none of that: it's real vector text,
 * not a raster screenshot, produced by the same mature pagination code Chromium already uses
 * for every ordinary print job.
 *
 * See lib/server/pdfRender.ts for the shared Chromium orchestration, and
 * print/market-bulletin/page.tsx for why the print target is a bare, chrome-free route.
 */
import { isAuthorized, renderPrintRouteToPdf } from "@/lib/server/pdfRender";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth || !(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const token = auth.replace(/^Bearer\s+/i, "");

  let catalogueId: string | undefined;
  let sourceName: string | undefined;
  try {
    const body = await request.json();
    catalogueId = body.catalogueId;
    sourceName = body.sourceName;
  } catch {
    // fall through to the missing-catalogueId check below
  }
  if (!catalogueId) {
    return NextResponse.json({ error: "catalogueId is required." }, { status: 400 });
  }

  try {
    const pdfBytes = await renderPrintRouteToPdf(request.url, "/print/market-bulletin", { catalogueId }, token);
    const saleTag = (sourceName ?? "").match(/\d+/)?.[0] ?? "draft";
    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="weekly-market-grade-classification-quotation-sale-${saleTag}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF export failed." }, { status: 500 });
  }
}
