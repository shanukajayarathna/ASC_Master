/**
 * Shared machinery behind every "Export PDF" button that needs a real, vector PDF instead of
 * an html2canvas screenshot — see api/reports/market-bulletin-pdf/route.ts and
 * api/reports/top-price-page-pdf/route.ts for the two current callers, and each's own
 * print/<report>/page.tsx for why the print target is a bare, chrome-free route rather than
 * the full app page.
 */
import { chromium } from "playwright";

export { isAuthorized } from "@/lib/server/session";

/** Launches headless Chromium, signs the print page in as the calling user (so it only ever
 *  sees what they're already allowed to), navigates to it, waits for the report to actually
 *  render, and prints it — real vector text via Chromium's own print engine (Playwright's
 *  page.pdf()), not a raster screenshot. */
export async function renderPrintRouteToPdf(requestUrl: string, printPath: string, searchParams: Record<string, string>, token: string): Promise<Buffer> {
  // requestUrl's host is whatever the caller's browser used to reach this Next.js server —
  // "0.0.0.0" when the dev server is bound to all interfaces (next dev -H 0.0.0.0), or a LAN
  // IP/Docker hostname in other setups. None of those are valid destinations for Playwright's
  // own headless Chromium to connect back to (it runs on this same machine), so the loopback
  // hop always targets localhost instead, keeping only the port the server is actually on.
  const requestOrigin = new URL(requestUrl);
  const localOrigin = `http://localhost:${requestOrigin.port || "80"}`;
  const printUrl = new URL(printPath, localOrigin);
  for (const [k, v] of Object.entries(searchParams)) printUrl.searchParams.set(k, v);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    // Sign the print page in as the caller: the session cookie the API would have set (host-wide, so it reaches both this
    // Next server and the API), plus the non-secret hint AuthProvider looks for before it asks the API who is signed in.
    await context.addCookies([{ name: "asc_session", value: token, url: localOrigin, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(() => window.localStorage.setItem("asc_session_hint", "1"));
    const page = await context.newPage();

    await page.goto(printUrl.toString(), { waitUntil: "load", timeout: 30000 });
    // The Market Bulletin's own 4th-page data (MarketBulletinMonthlyEngine) touches every sale in
    // a 2-month window; the FIRST time any one of those sales is read this way, SaleFileStore
    // builds its own compact per-sale cache from the existing full-sale one — confirmed live at
    // ~5-6s per untouched sale on an otherwise-idle machine, so a full cold window (~8-10 sales)
    // can take 40-60s the very first time that month is ever viewed. 30s was tuned for the OTHER
    // report (Top Price Page, one sale, a few seconds) and left this one failing on exactly that
    // first view. Confirmed live on the actual dev machine this runs on (shared with other real
    // work, so its free memory/CPU swings unpredictably): three otherwise-identical cold-ish runs
    // measured 28.6s, 72.5s, and one that exceeded even 120s — the same request, same warm
    // caches, wildly different wall-clock time purely from contention with whatever else that
    // machine was doing at that moment. 180s buys real margin against that swing without the
    // caller waiting meaningfully longer on the common case, which finishes in seconds once this
    // month's sales are warm (that per-sale cache persists to disk, across restarts too).
    await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150); // one paint settle past fonts.ready

    await page.emulateMedia({ media: "print" });
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close().catch(() => {});
  }
}
