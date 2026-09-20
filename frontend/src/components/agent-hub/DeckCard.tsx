"use client";

import { api } from "@/lib/api";
import type { CustomPreview, DeckReport } from "@/types/api";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Link from "next/link";
import { useState } from "react";
import { MAX_DECK_REPORTS, deckReportKey, deckSlideCount, safeFileName, toDeckReport, type VisualKey } from "./reportBuilder";

type Template = "ivory" | "ink";

interface DeckCardProps {
  preview: CustomPreview | null;
  visual: VisualKey;
}

/**
 * The PowerPoint card. Build a deck from one report (the one on screen) or several ("Add to deck"), pick the
 * template and how many slides, and generate. The deck has native charts and tables and is saved under Saved
 * Reports; the download starts straight away.
 */
export default function DeckCard({ preview, visual }: DeckCardProps) {
  const [deck, setDeck] = useState<DeckReport[]>([]);
  const [template, setTemplate] = useState<Template>("ivory");
  const [slides, setSlides] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; saved?: boolean } | null>(null);

  const current = preview ? toDeckReport(preview, visual) : null;
  // With nothing added yet, the deck is simply the report on screen.
  const reports = deck.length > 0 ? deck : current ? [current] : [];
  const available = reports.length > 0 ? deckSlideCount(reports) : 0;
  const chosen = Math.min(slides ?? available, available);
  const canAdd = current !== null && deck.length < MAX_DECK_REPORTS && !deck.some((r) => deckReportKey(r) === deckReportKey(current));

  const generate = async () => {
    if (reports.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const title = reports.length === 1 ? reports[0].title : `${reports[0].title} + ${reports.length - 1} more`;
      const saved = await api.generateReportDeck({ title, template, maxSlides: chosen, reports });
      const { blob, fileName } = await api.downloadSavedReport(saved.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? `${safeFileName(title)}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ text: `PowerPoint downloaded (${chosen} slide${chosen === 1 ? "" : "s"}).`, saved: true });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Couldn't build the PowerPoint — try again.", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ws-out" aria-label="PowerPoint">
      <h3 className="ws-out-title">PowerPoint</h3>
      <p className="ws-lots-note">Native charts and tables. Add reports to make a longer deck.</p>

      <Button variant="outlined" size="small" disabled={!canAdd} onClick={() => current && setDeck((d) => [...d, current])} sx={{ minHeight: 40 }}>
        Add this report to the deck
      </Button>

      {deck.length > 0 && (
        <ol className="ws-deck-list" aria-label="Reports in the deck">
          {deck.map((r, i) => (
            <li key={deckReportKey(r)}>
              <span>{r.title}</span>
              <Button size="small" onClick={() => setDeck((d) => d.filter((_, j) => j !== i))} aria-label={`Remove ${r.title} from the deck`} sx={{ minHeight: 36 }}>
                Remove
              </Button>
            </li>
          ))}
        </ol>
      )}

      <div className="ws-seg">
        <span className="ws-seg-label" id="deck-template">Template</span>
        <ToggleButtonGroup exclusive size="small" value={template} onChange={(_, v: Template | null) => v && setTemplate(v)} aria-labelledby="deck-template">
          <ToggleButton value="ivory" sx={{ textTransform: "none", minHeight: 40, minWidth: 44, px: 1.25 }}>ASC Ivory</ToggleButton>
          <ToggleButton value="ink" sx={{ textTransform: "none", minHeight: 40, minWidth: 44, px: 1.25 }}>ASC Ink</ToggleButton>
        </ToggleButtonGroup>
      </div>

      <div className="ws-seg">
        <span className="ws-seg-label" id="deck-slides">Slides</span>
        <div className="ws-stepper" role="group" aria-labelledby="deck-slides">
          <IconButton aria-label="Fewer slides" disabled={chosen <= 2} onClick={() => setSlides(chosen - 1)} sx={{ width: 44, height: 44 }}>
            <RemoveIcon fontSize="small" />
          </IconButton>
          <span className="ws-stepper-value" aria-live="polite">{available === 0 ? "—" : chosen}</span>
          <IconButton aria-label="More slides" disabled={chosen >= available} onClick={() => setSlides(chosen + 1)} sx={{ width: 44, height: 44 }}>
            <AddIcon fontSize="small" />
          </IconButton>
          <span className="ws-lots-note">of {available || "—"} available (max 12)</span>
        </div>
      </div>

      <Button variant="contained" disabled={reports.length === 0 || busy} onClick={generate} sx={{ minHeight: 44 }}>
        {busy ? "Building…" : "Generate PowerPoint"}
      </Button>
      <p className="ws-lots-note" role="status" aria-live="polite" style={message?.error ? { color: "var(--danger)" } : undefined}>
        {message?.text} {message?.saved && <Link href="/saved-reports" className="ws-out-link">Open Saved Reports</Link>}
      </p>
    </section>
  );
}
