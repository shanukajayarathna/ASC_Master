"use client";

import { RichText } from "@/components/assistant/RichText";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { SavedReport } from "@/types/api";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * Chrome-free print target for a saved custom report (a snapshot saved from the AI Assistant):
 * the answer's scope, tables and charts, and nothing else on the page — the same bare-route
 * pattern as print/market-bulletin (see its doc comment for why it lives outside the (app) group
 * and wraps its content in .print-root). It opens the browser's print dialog once the charts have
 * measured and drawn, so "Save as PDF" captures a finished frame, not a mid-layout one.
 */
export default function CustomReportPrintPage() {
  return (
    <Suspense fallback={<div data-ready="false" />}>
      <CustomReportPrintContent />
    </Suspense>
  );
}

function CustomReportPrintContent() {
  const { loading: authLoading } = useAuth();
  const id = useSearchParams().get("id");
  const [report, setReport] = useState<SavedReport | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !id) return;
    Promise.all([api.listSavedReports(), api.getSavedReportContent(id)])
      .then(([list, c]) => {
        setReport(list.find((r) => r.id === id) ?? null);
        setContent(c.content);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [authLoading, id]);

  // Charts size themselves from their container (ResizeObserver), so give them a beat to settle
  // after first paint before handing over to the print dialog.
  const ready = content !== null;
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => window.print(), 700);
    return () => window.clearTimeout(t);
  }, [ready]);

  if (!id) return <div data-error="missing id" className="p-6 text-[13px]">No report selected.</div>;
  if (error) return <div data-error={error} className="p-6 text-[13px]">Couldn&apos;t load this report: {error}</div>;
  if (content === null) return <div data-ready="false" className="p-6 text-[13px] text-text-muted">Preparing report…</div>;

  return (
    <div className="print-root mx-auto max-w-[190mm] px-4 py-6" data-ready="true">
      <style>{"@media print { @page { size: A4; margin: 12mm; } }"}</style>
      <h1 className="font-display text-[22px] font-semibold text-text-strong m-0 mb-1">{report?.title ?? "Custom report"}</h1>
      {report && (
        <p className="text-[12px] text-text-muted m-0 mb-4">
          Snapshot saved {new Date(report.createdAt).toLocaleString()} · figures don&apos;t change if the data is updated later
        </p>
      )}
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
        <RichText text={content} />
      </div>
    </div>
  );
}
