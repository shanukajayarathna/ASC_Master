/**
 * Server-to-server only — called by the .NET backend's WeeklyFactAutoReportJob, never by a
 * browser. Runs the exact same, already-verified generation pipeline the manual "Generate"
 * button on /reports/weekly-fact calls (runJob, wesReportFromDatabase — see
 * weeklyFactReport.ts), just invoked headlessly instead of from a click, so the automated job
 * never re-derives or reimplements that logic.
 *
 * Deliberately produces xlsx workbooks only, no PDFs: the PDF builders (weeklyFactPdf.ts) call
 * worksheetPdf.ts's loadImage for the letterhead logo, which uses `new Image()` and a
 * `<canvas>` — no Node equivalent without a native canvas dependency. That's a disclosed,
 * narrower scope than the manual flow's full xlsx+pdf bundle, not an oversight.
 */
import { runJob, wesReportFromDatabase } from "@/lib/weeklyFactReport";
import type { WesEquivalentApi } from "@/types/api";
import JSZip from "jszip";
import { NextResponse } from "next/server";

interface GenerateRequestBody {
  saleYear: number;
  saleNo: number;
  cbacTxtContent: string;
  wesEquivalent: WesEquivalentApi;
}

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "INTERNAL_JOB_SECRET is not configured on the frontend server." }, { status: 500 });
  }
  if (request.headers.get("x-internal-job-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let bodyIn: GenerateRequestBody;
  try {
    bodyIn = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON body." }, { status: 400 });
  }

  try {
    const wesReport = wesReportFromDatabase(bodyIn.wesEquivalent);
    const job = await runJob(bodyIn.cbacTxtContent, { source: "database", report: wesReport }, {});

    const zip = new JSZip();
    const addIfPresent = (entry: { filename: string | null; buffer: ArrayBuffer | null } | null | undefined) => {
      if (entry?.buffer && entry.filename) zip.file(entry.filename, entry.buffer);
    };
    for (const outcome of job.outcomes) addIfPresent(outcome);
    addIfPresent(job.rankWorkbook);
    addIfPresent(job.lowRankWorkbook);
    addIfPresent(job.lowMarkWorkbook);

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipFileName = `weekly_reports_sale${job.saleNumber ?? bodyIn.saleNo}_${bodyIn.saleYear}.zip`;

    return NextResponse.json({
      ok: true,
      saleNumber: job.saleNumber,
      saleDate: job.saleDate,
      warnings: job.warnings,
      zipFileName,
      zipBase64: zipBuffer.toString("base64"),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
