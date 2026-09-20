"use client";

import ChartBlock, { type ChartSpec } from "@/components/assistant/ChartBlock";
import Button from "@mui/material/Button";
import { MAX_PINS, type Pin } from "./pins";

/** A compact, model-free description of a chart's own figures, so "explain this chart" never depends on it being in the chat history. */
export function chartSummary(spec: ChartSpec): string {
  const rows = spec.categories.slice(0, 20).map((c, i) => `${c}: ${spec.series.map((s) => `${s.name}=${s.values[i] ?? "n/a"}`).join(", ")}`);
  return `${spec.title}${spec.subtitle ? ` (${spec.subtitle})` : ""}, unit ${spec.unit}. ${rows.join("; ")}`.slice(0, 1800);
}

export const explainChartPrompt = (spec: ChartSpec) =>
  `Explain this chart: what it shows and what stands out. Use only these figures, no others. ${chartSummary(spec)}`;

export const drillPrompt = (spec: ChartSpec, category: string) =>
  `Drill into "${category}" from the chart "${spec.title}": break it down further by whichever of grade, broker or sale fits, and show a table and a chart.`;

interface PinnedBoardProps {
  pins: Pin[];
  onUnpin: (id: string) => void;
  onAsk: (question: string) => void;
  busy: boolean;
}

/** The pinned-insights board: charts and answers kept from earlier questions, each explainable again or removable. */
export default function PinnedBoard({ pins, onUnpin, onAsk, busy }: PinnedBoardProps) {
  return (
    <section className="ws-board" aria-label="Pinned insights">
      <h2 className="ws-lots-title">
        Pinned insights <span className="ws-board-count">{pins.length}/{MAX_PINS}</span>
      </h2>
      {pins.length === 0 ? (
        <p className="ws-lots-note">Pin a chart or answer from the chat to keep it here. Pins are saved in this browser only.</p>
      ) : (
        <ul className="ws-lot-list">
          {pins.map((p) => (
            <li key={p.id} className="ws-pin">
              <div className="ws-pin-head">
                <span className="ws-pin-title">{p.kind === "chart" ? "Chart" : "Answer"}</span>
                <Button size="small" onClick={() => onUnpin(p.id)} aria-label={`Unpin ${p.title}`} sx={{ minHeight: 36 }}>
                  Unpin
                </Button>
              </div>
              {p.kind === "chart" && p.chart ? (
                <>
                  <ChartBlock spec={p.chart} />
                  <Button size="small" variant="outlined" disabled={busy} onClick={() => onAsk(explainChartPrompt(p.chart!))} sx={{ minHeight: 40, mt: 0.5 }}>
                    Explain this chart
                  </Button>
                </>
              ) : (
                <p className="ws-pin-text">{p.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
