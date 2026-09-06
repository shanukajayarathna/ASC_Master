/**
 * Server-side Top Price Page PDF export via a real headless Chromium print (Playwright's
 * page.pdf()), replacing the old client-side html2canvas+jsPDF screenshot approach — same
 * fix, and same reasoning, as api/reports/market-bulletin-pdf/route.ts.
 *
 * See lib/server/pdfRender.ts for the shared Chromium orchestration, and
 * print/top-price-page/page.tsx for why the print target is a bare, chrome-free route.
 */
import { isAuthorized, renderPrintRouteToPdf } from "@/lib/server/pdfRender";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth || !(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const token = auth.replace(/^Bearer\s+/i, "");

  let catalogueId: string | undefined;
  let auctionNumber: string | undefined;
  try {
    const body = await request.json();
    catalogueId = body.catalogueId;
    auctionNumber = body.auctionNumber;
  } catch {
    // fall through to the missing-catalogueId check below
  }
  if (!catalogueId) {
    return NextResponse.json({ error: "catalogueId is required." }, { status: 400 });
  }

  try {
    const pdfBytes = await renderPrintRouteToPdf(request.url, "/print/top-price-page", { catalogueId }, token);
    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="top-price-page-sale-${auctionNumber || "draft"}-${dateStamp()}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF export failed." }, { status: 500 });
  }
}
