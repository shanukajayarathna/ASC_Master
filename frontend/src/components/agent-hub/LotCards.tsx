"use client";

import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { Lot } from "@/types/api";
import Button from "@mui/material/Button";
import { useState } from "react";

/** "Rs 1,240" / "Rs 1,100 – 1,300" / null when the lot has no valuation yet. */
export function valuationLabel(lot: Lot): string | null {
  const v = lot.valuation;
  if (!v) return null;
  const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v.valuationFrom != null && v.valuationTo != null) return `Rs ${n(v.valuationFrom)} – ${n(v.valuationTo)}`;
  if (v.valuationSingle != null) return `Rs ${n(v.valuationSingle)}`;
  return null;
}

/** A lot's valuation as one number: the single value, or the middle of its range. Null when it has none. */
export function effectiveValue(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle != null) return v.valuationSingle;
  if (v.valuationFrom != null && v.valuationTo != null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom ?? v.valuationTo ?? null;
}

const describe = (lot: Lot) => [lot.garden, lot.grade && `grade ${lot.grade}`, lot.broker && `broker ${lot.broker}`].filter(Boolean).join(", ");

/** The questions a lot card asks the assistant. Read-only: they only ever ask, never change a lot. */
export const explainPrompt = (lot: Lot) => `Explain the valuation for lot ${lot.lotNumber ?? "?"} (${describe(lot)}) in the active sale: what drives its range?`;
export const comparePrompt = (lot: Lot) =>
  `Compare lot ${lot.lotNumber ?? "?"} (${describe(lot)}) in the active sale with other${lot.grade ? ` ${lot.grade}` : ""} lots and with ${lot.broker ?? "its broker"}'s average: is it priced above or below?`;

/** The lot number in a message like "valuation of lot 1204" or "lot #1204" — or null when none is mentioned. */
export function lotNumberIn(text: string): string | null {
  return text.match(/\blot\s*(?:no\.?|number|#)?\s*(\d{1,6})\b/i)?.[1] ?? null;
}

type Ladder = { lotId: string; rows: Lot[] } | { lotId: string; error: true } | { lotId: string; loading: true } | null;

interface LotCardsProps {
  lots: Lot[];
  /** Sends a question to the chat. */
  onAsk: (question: string) => void;
  busy: boolean;
}

/** Lot cards in the conversation: garden, grade, broker, weight, valuation, and Explain / Compare / Price ladder. */
export default function LotCards({ lots, onAsk, busy }: LotCardsProps) {
  const { activeCatalogueId } = useCatalogue();
  const [selectedId, setSelectedId] = useState<string | null>(lots.length === 1 ? lots[0].id : null);
  const [ladder, setLadder] = useState<Ladder>(null);

  /** The three highest-valued lots of this lot's grade in the active sale, to see where it sits. */
  const showLadder = (lot: Lot) => {
    if (!activeCatalogueId || !lot.grade) return;
    setLadder({ lotId: lot.id, loading: true });
    api
      .getLots(activeCatalogueId, { grade: lot.grade, sortKey: "Valuation", sortDir: -1, pageSize: 3 })
      .then((res) => setLadder({ lotId: lot.id, rows: res.rows }))
      .catch(() => setLadder({ lotId: lot.id, error: true }));
  };

  return (
    <ul className="ws-lot-list" aria-label="Lots">
      {lots.map((lot) => {
        const selected = lot.id === selectedId;
        const value = valuationLabel(lot);
        return (
          <li key={lot.id} className="ws-lot" data-selected={selected ? "true" : "false"}>
            <button type="button" className="ws-lot-head" aria-expanded={selected} onClick={() => setSelectedId(selected ? null : lot.id)}>
              <span className="ws-lot-no">Lot {lot.lotNumber ?? "—"}</span>
              <span className="ws-lot-garden">{lot.garden ?? "Unknown garden"}</span>
              <span className="ws-lot-meta">{[lot.grade, lot.broker, lot.netWeight != null ? `${lot.netWeight.toLocaleString()} kg` : null].filter(Boolean).join(" · ")}</span>
              <span className="ws-lot-value">{value ?? "Not valued yet"}</span>
            </button>
            {selected && (
              <div className="ws-lot-actions">
                <Button size="small" variant="contained" disabled={busy} onClick={() => onAsk(explainPrompt(lot))} sx={{ minHeight: 40 }}>
                  Explain valuation
                </Button>
                <Button size="small" variant="outlined" disabled={busy} onClick={() => onAsk(comparePrompt(lot))} sx={{ minHeight: 40 }}>
                  Compare with grade &amp; broker
                </Button>
                {lot.grade && (
                  <Button size="small" variant="outlined" onClick={() => showLadder(lot)} sx={{ minHeight: 40 }}>
                    Price ladder
                  </Button>
                )}
              </div>
            )}
            {selected && ladder?.lotId === lot.id && (
              <div className="ws-ladder" role="status">
                {"loading" in ladder ? (
                  <span>Loading the ladder…</span>
                ) : "error" in ladder ? (
                  <span className="ws-lots-error">Couldn&apos;t load the ladder.</span>
                ) : (
                  <>
                    <strong>Top {ladder.rows.length} {lot.grade} lots by valuation</strong>
                    <ol>
                      {ladder.rows.map((r) => (
                        <li key={r.id} data-self={r.id === lot.id ? "true" : "false"}>
                          <span>Lot {r.lotNumber ?? "—"} · {r.garden ?? "?"}</span>
                          <span>{valuationLabel(r) ?? "—"}</span>
                        </li>
                      ))}
                    </ol>
                    {!ladder.rows.some((r) => r.id === lot.id) && <span>This lot: {valuationLabel(lot) ?? "not valued yet"}</span>}
                    <em>Valuations, not achieved prices — the archive has no result for this sale yet.</em>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Finds the lot(s) a question is about, in the active sale, for the card shown under the answer. Empty when none match. */
export function useLotsFor() {
  const { activeCatalogueId } = useCatalogue();
  return async (number: string): Promise<Lot[]> => {
    if (!activeCatalogueId) return [];
    const res = await api.getLots(activeCatalogueId, { search: number, pageSize: 3 });
    // Search is a substring match, so keep only lots whose number is exactly the one asked about when there is one.
    const exact = res.rows.filter((l) => l.lotNumber === number);
    return exact.length > 0 ? exact : res.rows;
  };
}
