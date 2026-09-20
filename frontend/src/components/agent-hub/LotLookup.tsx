"use client";

import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { Lot } from "@/types/api";
import SearchIcon from "@mui/icons-material/Search";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";

const RESULT_LIMIT = 8;
const DEBOUNCE_MS = 350;

/** "Rs 1,240" / "Rs 1,100 – 1,300" / null when the lot has no valuation yet. */
export function valuationLabel(lot: Lot): string | null {
  const v = lot.valuation;
  if (!v) return null;
  const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v.valuationFrom != null && v.valuationTo != null) return `Rs ${n(v.valuationFrom)} – ${n(v.valuationTo)}`;
  if (v.valuationSingle != null) return `Rs ${n(v.valuationSingle)}`;
  return null;
}

const describe = (lot: Lot) =>
  [lot.garden, lot.grade && `grade ${lot.grade}`, lot.broker && `broker ${lot.broker}`].filter(Boolean).join(", ");

/** The questions a lot card asks the Auction agent. Read-only: they only ever ask, never change a lot. */
export const explainPrompt = (lot: Lot) => `Explain the valuation for lot ${lot.lotNumber ?? "?"} (${describe(lot)}) in the active sale: what drives its range?`;
export const comparePrompt = (lot: Lot) =>
  `Compare lot ${lot.lotNumber ?? "?"} (${describe(lot)}) in the active sale with other${lot.grade ? ` ${lot.grade}` : ""} lots and with ${lot.broker ?? "its broker"}'s average: is it priced above or below?`;

interface LotLookupProps {
  /** Sends a question to the workspace's chat. */
  onAsk: (question: string) => void;
  busy: boolean;
}

/**
 * Find a lot in the active sale and ask the Auction agent about it. Search runs against the sale's own lot
 * list (lot number, garden, mark, invoice); a chosen lot offers "Explain valuation" and "Compare with grade
 * and broker", which hand a precise question to the chat — the agent does the analysis with its read-only tools.
 */
export default function LotLookup({ onAsk, busy }: LotLookupProps) {
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [query, setQuery] = useState("");
  const [lots, setLots] = useState<Lot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The query the shown results answer, so "no matches" is never claimed before the search has run. */
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!activeCatalogueId || !q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the box is emptied
      setLots([]);
      setTotal(0);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      api
        .getLots(activeCatalogueId, { search: q, pageSize: RESULT_LIMIT })
        .then((res) => {
          if (cancelled) return;
          setLots(res.rows);
          setTotal(res.total);
          setSettledQuery(q);
        })
        .catch(() => !cancelled && setFailed(true))
        .finally(() => !cancelled && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeCatalogueId]);

  return (
    <aside className="ws-lots" aria-label="Lot lookup">
      <h2 className="ws-lots-title">Lot lookup</h2>
      <TextField
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Lot no., garden, mark or invoice"
        size="small"
        fullWidth
        disabled={!activeCatalogueId}
        slotProps={{
          htmlInput: { "aria-label": "Search lots" },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
        }}
      />

      {!activeCatalogueId && <p className="ws-lots-note">Pick a sale in the top bar to look up its lots.</p>}
      {activeCatalogueId && !query.trim() && (
        <p className="ws-lots-note">Searching {activeCatalogue?.sourceName ?? "the active sale"}. Choose a lot to explain its valuation or compare its price.</p>
      )}
      {loading && <p className="ws-lots-note" role="status">Searching…</p>}
      {failed && <p className="ws-lots-note ws-lots-error" role="alert">Couldn&apos;t search lots. Try again.</p>}
      {!loading && !failed && settledQuery === query.trim() && lots.length === 0 && <p className="ws-lots-note" role="status">No lots match “{query.trim()}”.</p>}

      <ul className="ws-lot-list">
        {lots.map((lot) => {
          const selected = lot.id === selectedId;
          const value = valuationLabel(lot);
          return (
            <li key={lot.id} className="ws-lot" data-selected={selected ? "true" : "false"}>
              <button type="button" className="ws-lot-head" aria-expanded={selected} onClick={() => setSelectedId(selected ? null : lot.id)}>
                <span className="ws-lot-no">Lot {lot.lotNumber ?? "—"}</span>
                <span className="ws-lot-garden">{lot.garden ?? "Unknown garden"}</span>
                <span className="ws-lot-meta">
                  {[lot.grade, lot.broker, lot.netWeight != null ? `${lot.netWeight.toLocaleString()} kg` : null].filter(Boolean).join(" · ")}
                </span>
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
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {total > lots.length && lots.length > 0 && <p className="ws-lots-note">Showing {lots.length} of {total.toLocaleString()} — narrow the search to see others.</p>}
    </aside>
  );
}
