/**
 * Generic .xlsx -> PDF conversion via a real headless LibreOffice call, so the result is
 * pixel-for-pixel what Excel's own File > Export > Create PDF would produce from the same
 * file. This is the same mechanism as reports/weekly-fact's own conversion route
 * (frontend/src/app/api/weekly-fact/pdf/route.ts) minus that route's one report-specific
 * step (stripping a leftover "Sheet1" from RANK/LOW workbooks) — a plain, reusable sibling
 * so a new report doesn't need its own bespoke PDF endpoint just to call soffice.
 *
 * Browser-facing only: checks the caller's own bearer token against the .NET backend's
 * /auth/me, same as weekly-fact/pdf/route.ts. Every report converting through this route
 * follows the same on-click, client-side, never-persisted pattern Weekly FACT already
 * established — see SharedMarkCatalogueGenerationService's own doc comment.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";

/** LIBREOFFICE_PATH overrides for a non-default install; otherwise the winget/apt default for
 *  the platform this process is running on. */
function sofficePath(): string {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH;
  return process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.exe" : "soffice";
}

async function isAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/me`, { headers: { Authorization: auth } });
    return res.ok;
  } catch {
    return false;
  }
}

/** The download's file name only — never used as a path component (the xlsx is written under
 *  a random uuid instead), so this just needs to be safe to put in a Content-Disposition header. */
function safeStem(rawFilename: string): string {
  let decoded = rawFilename;
  try {
    decoded = decodeURIComponent(rawFilename);
  } catch {
    // Not URI-encoded — use as-is.
  }
  const stem = decoded.replace(/\.xlsx$/i, "").replace(/[^\w.\- ]+/g, "_").trim();
  return stem || "report";
}

/** Headless LibreOffice locks its user profile directory, so concurrent conversions need their
 *  own profile (a fresh UserInstallation per call) or the second call fails outright — this
 *  isn't a shared long-lived soffice process for exactly that reason. */
function convertToPdf(xlsxPath: string, outDir: string, profileDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sofficePath(), [
      `-env:UserInstallation=file:///${profileDir.replace(/\\/g, "/")}`,
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf:calc_pdf_Export",
      "--outdir",
      outDir,
      xlsxPath,
    ]);
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(new Error(`Couldn't start LibreOffice (${sofficePath()}): ${err.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited with code ${code}: ${stderr.trim()}`))));
  });
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rawBytes = Buffer.from(await request.arrayBuffer());
  if (rawBytes.length === 0) {
    return NextResponse.json({ error: "Empty request body — no workbook to convert." }, { status: 400 });
  }

  const stem = safeStem(request.headers.get("x-filename") ?? "report.xlsx");
  const workDir = await mkdtemp(path.join(tmpdir(), "xlsx-to-pdf-"));
  const profileDir = await mkdtemp(path.join(tmpdir(), "xlsx-to-pdf-lo-"));

  try {
    const xlsxPath = path.join(workDir, `${randomUUID()}.xlsx`);
    await writeFile(xlsxPath, rawBytes);
    await convertToPdf(xlsxPath, workDir, profileDir);
    const pdfBytes = await readFile(xlsxPath.replace(/\.xlsx$/i, ".pdf"));
    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${stem}.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Conversion failed." }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
