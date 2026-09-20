"use client";

import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { api } from "@/lib/api";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useState } from "react";
import { specSnapshot, specToDeckReport, specToPreview } from "./chartExports";
import { downloadXlsx, safeFileName } from "./reportBuilder";

const DRILL_CHIPS = 6;

interface ChartActionsProps {
  spec: ChartSpec;
  busy: boolean;
  pinned: boolean;
  /** Sends a follow-up question into the chat. */
  onAsk: (question: string) => void;
  onPin: () => void;
  /** Opens the report canvas for this chart's request; absent when there is nothing to open. */
  onEdit?: () => void;
  explainPrompt: (spec: ChartSpec) => string;
  drillPrompt: (spec: ChartSpec, category: string) => string;
}

type Working = null | "excel" | "save" | "pdf" | "deck";

/**
 * What you can do with any chart in the conversation: ask about it (Explain, drill into a category), keep it (Pin,
 * Save), take it away (Excel, PDF, PowerPoint) or open it in the report canvas to change it. Everything here uses the
 * chart's own numbers — nothing is re-queried and nothing passes through a model.
 */
export default function ChartActions({ spec, busy, pinned, onAsk, onPin, onEdit, explainPrompt, drillPrompt }: ChartActionsProps) {
  const [working, setWorking] = useState<Working>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (kind: Exclude<Working, null>, action: () => Promise<string | void>) => {
    setWorking(kind);
    setNote(null);
    try {
      const text = await action();
      if (text) setNote({ text });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : "That didn't work — try again.", error: true });
    } finally {
      setWorking(null);
    }
  };

  const save = async () => {
    if (savedId) return savedId;
    const report = await api.saveCustomReport(spec.title, specSnapshot(spec));
    setSavedId(report.id);
    return report.id;
  };

  const disabled = working !== null;

  return (
    <div className="ws-chart-actions">
      <Button size="small" variant="outlined" disabled={busy} onClick={() => onAsk(explainPrompt(spec))} sx={{ minHeight: 40 }}>
        Explain this chart
      </Button>
      <Button size="small" variant="outlined" disabled={pinned} onClick={onPin} sx={{ minHeight: 40 }}>
        {pinned ? "Pinned" : "Pin"}
      </Button>
      <Button size="small" variant="outlined" disabled={disabled} onClick={() => run("excel", async () => { await downloadXlsx(specToPreview(spec)); return "Excel downloaded."; })} sx={{ minHeight: 40 }}>
        Excel
      </Button>
      <Button size="small" variant="outlined" disabled={disabled} onClick={() => run("pdf", async () => { const id = await save(); window.open(`/print/custom-report?id=${id}`, "_blank", "noopener"); })} sx={{ minHeight: 40 }}>
        PDF
      </Button>
      <Button size="small" variant="outlined" disabled={disabled || savedId !== null} onClick={() => run("save", async () => { await save(); return "Saved under Saved Reports."; })} sx={{ minHeight: 40 }}>
        {savedId ? "Saved" : "Save"}
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        onClick={() =>
          run("deck", async () => {
            const saved = await api.generateReportDeck({ title: spec.title, template: "ivory", maxSlides: 3, reports: [specToDeckReport(spec)] });
            const { blob, fileName } = await api.downloadSavedReport(saved.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName ?? `${safeFileName(spec.title)}.pptx`;
            a.click();
            URL.revokeObjectURL(url);
            return "PowerPoint downloaded.";
          })
        }
        sx={{ minHeight: 40 }}
      >
        {working === "deck" ? "Building…" : "PowerPoint"}
      </Button>
      {onEdit && (
        <Button size="small" variant="contained" onClick={onEdit} sx={{ minHeight: 40 }}>
          Edit in report canvas
        </Button>
      )}
      {spec.categories.length > 1 && (
        <div className="ws-drill" role="group" aria-label="Drill down">
          <span className="ws-drill-label">Drill into</span>
          {spec.categories.slice(0, DRILL_CHIPS).map((c) => (
            <Chip key={c} label={c} size="small" variant="outlined" clickable disabled={busy} onClick={() => onAsk(drillPrompt(spec, c))} sx={{ height: 32 }} />
          ))}
        </div>
      )}
      <p className="ws-lots-note m-0" role="status" aria-live="polite" style={note?.error ? { color: "var(--danger)" } : undefined}>{note?.text}</p>
    </div>
  );
}
