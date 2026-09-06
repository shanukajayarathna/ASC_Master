/**
 * Shared machinery behind every "Export PDF" button that needs a real, vector PDF instead of
 * an html2canvas screenshot — see api/reports/market-bulletin-pdf/route.ts and
 * api/reports/top-price-page-pdf/route.ts for the two current callers, and each's own
 * print/<report>/page.tsx for why the print target is a bare, chrome-free route rather than
 * the full app page.
 */
import { chromium } from "playwright";

/** Checks the caller's own bearer token against the .NET backend, same pattern every
 *  PDF-conversion route in this app already uses (see xlsx-to-pdf/route.ts). */
export async function isAuthorized(request: Request): Promise<boolean> {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/me`, { headers: { Authorization: auth } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Launches headless Chromium, signs the print page in as the calling user (so it only ever
 *  sees what they're already allowed to), navigates to it, waits for the report to actually
 *  render, and prints it — real vector text via Chromium's own print engine (Playwright's
 *  page.pdf()), not a raster screenshot. */
export async function renderPrintRouteToPdf(requestUrl: string, printPath: string, searchParams: Record<string, string>, token: string): Promise<Buffer> {
  const printUrl = new URL(printPath, requestUrl);
  for (const [k, v] of Object.entries(searchParams)) printUrl.searchParams.set(k, v);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    // Same localStorage key AuthContext persists the bearer token under (lib/api.ts's
    // AUTH_TOKEN_STORAGE_KEY) — set via addInitScript so it exists before the print page's
    // own AuthProvider mounts and hydrates from it.
    await context.addInitScript((t) => window.localStorage.setItem("asc_auth_token", t), token);
    const page = await context.newPage();

    await page.goto(printUrl.toString(), { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-ready="true"]', { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150); // one paint settle past fonts.ready

    await page.emulateMedia({ media: "print" });
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close().catch(() => {});
  }
}
