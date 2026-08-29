/**
 * Converts a Weekly FACT workbook (.xlsx — a FACT category / RANK / LOW RANK / LOW MARK sheet,
 * each already carrying its own print area + fit-to-page + margins, see weeklyFactReport.ts's
 * pageSetup assignments) into a PDF via a real LibreOffice headless conversion, so the result
 * is pixel-for-pixel what Excel's own File > Export > Create PDF would produce from the same
 * file — not a redrawn approximation (that's what the jsPDF builders this replaces were:
 * see weeklyFactPdf.ts's file-level comment).
 *
 * Browser-facing (called from reports/weekly-fact/page.tsx via api.convertWeeklyFactPdf), unlike
 * the internal/ route beside this one which trusts a shared secret for server-to-server calls —
 * this one instead checks the caller's own bearer token against the .NET backend's /auth/me.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
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

/** RANK FAC and the LOW RANK/MARK WISE workbooks carry a "Sheet1" alongside their real content
 *  — a raw copy of the WES working file (RANK) or a leftover template artifact riding along
 *  untouched (LOW) — that the original jsPDF mirrors deliberately left out of the PDF as "an
 *  internal working reference, not report content" (see weeklyFactPdf.ts's prior file-level
 *  comment). A real xlsx→PDF conversion has no such filter built in — it prints every sheet —
 *  so that exclusion has to happen here, on the workbook itself, before conversion. Guarded to
 *  workbooks with more than one sheet so a FACT category workbook (a single real sheet, whose
 *  own template may itself be named "Sheet1") is never emptied out. */
async function stripWorkingCopySheet(bytes: Buffer): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // exceljs's own .d.ts types load() as taking a Buffer, but a plain Buffer's structural type
  // no longer satisfies newer @types/node's Buffer interface (it gained members like
  // `resizable` that Buffer.from(...) doesn't produce) — every other load() call in this
  // codebase already sidesteps this by passing a plain ArrayBuffer instead (see
  // weeklyFactReport.ts), which this mirrors.
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (wb.worksheets.length <= 1) return bytes;
  const sheet1 = wb.getWorksheet("Sheet1");
  if (!sheet1) return bytes;
  wb.removeWorksheet(sheet1.id);
  return Buffer.from(await wb.xlsx.writeBuffer());
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
  const workDir = await mkdtemp(path.join(tmpdir(), "weekly-fact-pdf-"));
  const profileDir = await mkdtemp(path.join(tmpdir(), "weekly-fact-lo-"));

  try {
    const bytes = await stripWorkingCopySheet(rawBytes);
    const xlsxPath = path.join(workDir, `${randomUUID()}.xlsx`);
    await writeFile(xlsxPath, bytes);
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
