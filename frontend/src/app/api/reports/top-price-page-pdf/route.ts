/**
 * Server-side Top Price Page PDF export via a real headless Chromium print (Playwright's
 * page.pdf()), replacing the old client-side html2canvas+jsPDF screenshot approach — same
 * fix, and same reasoning, as api/reports/market-bulletin-pdf/route.ts.
 *
 * See lib/server/pdfRender.ts for the shared Chromium orchestration, and
 * print/top-price-page/page.tsx for why the print target is a bare, chrome-free route.
 */
import { isAuthorized, renderPrintRouteToPdf } from "@/lib/server/pdfRender";
import { getSessionToken } from "@/lib/server/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body values are client-controlled: keep only filename-safe characters before one goes into a
 *  Content-Disposition header (a quote or control character there would break out of the
 *  filename token). */
function safeFilenamePart(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) : "";
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const token = getSessionToken(request);
  if (!token || !(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let catalogueId: string | undefined;
  let auctionNumber: string | undefined;
  let format: string | undefined;
  try {
    const body = await request.json();
    catalogueId = typeof body.catalogueId === "string" ? body.catalogueId : undefined;
    auctionNumber = safeFilenamePart(body.auctionNumber);
    format = body.format === "simple" ? "simple" : "detailed";
  } catch {
    // fall through to the missing-catalogueId check below
  }
  if (!catalogueId) {
    return NextResponse.json({ error: "catalogueId is required." }, { status: 400 });
  }
  if (!GUID.test(catalogueId)) {
    return NextResponse.json({ error: "catalogueId is not valid." }, { status: 400 });
  }

  try {
    const pdfBytes = await renderPrintRouteToPdf(
      request.url,
      "/print/top-price-page",
      format === "simple" ? { catalogueId, format: "simple" } : { catalogueId },
      token
    );
    return new NextResponse(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="top-price-page${format === "simple" ? "-simple" : ""}-sale-${auctionNumber || "draft"}-${dateStamp()}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF export failed." }, { status: 500 });
  }
}
