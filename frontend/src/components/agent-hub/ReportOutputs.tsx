"use client";

import { api } from "@/lib/api";
import type { CustomPreview } from "@/types/api";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useEffect, useState } from "react";
import { chartSpecFrom, downloadXlsx, snapshotContent, type VisualKey } from "./reportBuilder";

type Busy = null | "excel" | "pdf" | "snapshot";

interface ReportOutputsProps {
  preview: CustomPreview | null;
  visual: VisualKey;
}

/**
 * The right pane: what to do with the report. Excel is built in the browser from the preview's own numbers; a
 * snapshot saves the report (scope, chart, table) as a Saved Report; PDF saves one and opens its print page, where
 * the browser's Save as PDF captures it. PowerPoint and the voice builder are the next steps.
 */
export default function ReportOutputs({ preview, visual }: ReportOutputsProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [savedId, setSavedId] = useState<{ content: string; id: string } | null>(null);

  const content = preview ? snapshotContent(preview, chartSpecFrom(preview, visual)) : null;
  // A saved snapshot only counts while the preview still matches it.
  const saved = content && savedId?.content === content ? savedId.id : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the last result when the report changes
    setMessage(null);
  }, [content]);

  const save = async (): Promise<string | null> => {
    if (!preview || !content) return null;
    if (saved) return saved;
    const report = await api.saveCustomReport(preview.title, content);
    setSavedId({ content, id: report.id });
    return report.id;
  };

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "That didn't work — try again.", error: true });
    } finally {
      setBusy(null);
    }
  };

  const disabled = !preview || busy !== null;

  return (
    <aside className="ws-lots" aria-label="Output">
      <h2 className="ws-lots-title">Output</h2>

      <section className="ws-out">
        <h3 className="ws-out-title">Excel</h3>
        <p className="ws-lots-note">The table behind the report, as a workbook.</p>
        <Button variant="outlined" disabled={disabled} onClick={() => run("excel", async () => { await downloadXlsx(preview!); setMessage({ text: "Excel downloaded." }); })} sx={{ minHeight: 44 }}>
          {busy === "excel" ? "Building…" : "Download Excel"}
        </Button>
      </section>

      <section className="ws-out">
        <h3 className="ws-out-title">PDF</h3>
        <p className="ws-lots-note">Opens the print page — choose Save as PDF.</p>
        <Button
          variant="outlined"
          disabled={disabled}
          onClick={() => run("pdf", async () => { const id = await save(); if (id) window.open(`/print/custom-report?id=${id}`, "_blank", "noopener"); })}
          sx={{ minHeight: 44 }}
        >
          {busy === "pdf" ? "Preparing…" : "Open PDF"}
        </Button>
      </section>

      <section className="ws-out">
        <h3 className="ws-out-title">Save snapshot</h3>
        <p className="ws-lots-note">Keeps this report under Saved Reports, exactly as shown now.</p>
        <Button variant="contained" disabled={disabled || saved !== null} onClick={() => run("snapshot", async () => { await save(); setMessage({ text: "Saved — find it under Saved Reports." }); })} sx={{ minHeight: 44 }}>
          {saved ? "Saved" : busy === "snapshot" ? "Saving…" : "Save snapshot"}
        </Button>
        {saved && <Link href="/saved-reports" className="ws-out-link">Open Saved Reports</Link>}
      </section>

      <section className="ws-out ws-out-soon">
        <h3 className="ws-out-title">PowerPoint &amp; voice builder</h3>
        <p className="ws-lots-note">Coming next: a slide deck from this report, and building reports by speaking.</p>
      </section>

      <p className="ws-lots-note" role="status" aria-live="polite" style={message?.error ? { color: "var(--danger)" } : undefined}>{message?.text}</p>
    </aside>
  );
}
