"use client";

import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import type { Lot } from "@/types/api";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import TextField from "@mui/material/TextField";
import LinearProgress from "@mui/material/LinearProgress";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const PENDING_KEY = "asc:valuation:pending";
const RENDER_CAP = 300;

// The dataset's own header spelling varies catalogue to catalogue (e.g. "SellingMark" vs
// "Selling Mark"), and these three fields aren't promoted to typed Lot properties the way
// LotNumber/Grade/Mark are — so look them up from rawData by fuzzy header match instead.
function findRaw(lot: Lot, pattern: RegExp): string | null {
  const entry = Object.entries(lot.rawData).find(([k]) => pattern.test(k));
  return entry?.[1]?.trim() || null;
}

function sellingMarkOf(lot: Lot): string | null {
  return findRaw(lot, /selling.?mark/i);
}
function noOfChestsOf(lot: Lot): string | null {
  return findRaw(lot, /no.?of.?chests?|^chests?$/i);
}
function weightPerChestOf(lot: Lot): string | null {
  return findRaw(lot, /weight.?per.?chest/i);
}

function lotLabel(lot: Lot): string {
  return [lot.lotNumber ? `Lot ${lot.lotNumber}` : null, lot.grade, lot.mark].filter(Boolean).join(" · ") || lot.rowKey;
}

function lotMatches(lot: Lot, needle: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return (
    (lot.lotNumber ?? "").toLowerCase().includes(n) ||
    (lot.grade ?? "").toLowerCase().includes(n) ||
    (lot.mark ?? "").toLowerCase().includes(n) ||
    (lot.broker ?? "").toLowerCase().includes(n) ||
    (lot.category ?? "").toLowerCase().includes(n) ||
    (sellingMarkOf(lot) ?? "").toLowerCase().includes(n)
  );
}

type ParsedValuation =
  | { kind: "clear" }
  | { kind: "single"; value: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "error"; message: string };

// Auto-detects whether the typed text is a single LKR value ("1000") or a range
// ("1000-1100") — a dash between two numbers always means a range here since valuations
// are never negative, so there's no ambiguity with a minus sign.
function parseValuationInput(raw: string): ParsedValuation {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "") return { kind: "clear" };

  const rangeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    if (from >= to) return { kind: "error", message: "First value must be less than the second" };
    return { kind: "range", from, to };
  }

  const singleMatch = trimmed.match(/^\d+(?:\.\d+)?$/);
  if (singleMatch) return { kind: "single", value: Number(trimmed) };

  return { kind: "error", message: "Only numbers allowed — e.g. 1000 or 1000-1100" };
}

function valuationToText(lot: Lot): string {
  const v = lot.valuation;
  if (!v) return "";
  if (v.valuationSingle != null) return v.valuationSingle.toString();
  if (v.valuationFrom != null && v.valuationTo != null) return `${v.valuationFrom}-${v.valuationTo}`;
  return "";
}

export default function ValuationCentrePage() {
  const router = useRouter();
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"select" | "enter">("select");
  const [search, setSearch] = useState("");
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    // Data-fetch-on-dependency-change effect (clears lots synchronously for the no-catalogue
    // case before its async fetch), not the derived-state anti-pattern the rule targets.
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLots([]);
      return;
    }
    setLoading(true);
    api
      .getLots(activeCatalogueId, { pageSize: 5000 })
      .then((paged) => setLots(paged.rows))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  // Consume a one-shot handoff from the Catalogue Manager's "Valuation" button — if the user
  // arrived here with a pre-made selection for this catalogue, skip straight to entry.
  useEffect(() => {
    if (!activeCatalogueId || lots.length === 0) return;
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(PENDING_KEY);
    try {
      const pending = JSON.parse(raw) as { catalogueId: string; lotIds: string[] };
      if (pending.catalogueId !== activeCatalogueId) return;
      const validIds = pending.lotIds.filter((id) => lots.some((l) => l.id === id));
      if (validIds.length === 0) return;
      // One-shot handoff consumed inside an effect by design — not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrderedIds(validIds);
      setStep("enter");
    } catch {
      // ignore malformed handoff payload
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCatalogueId, lots.length]);

  const filteredLots = useMemo(() => lots.filter((l) => lotMatches(l, search)), [lots, search]);
  const visibleLots = filteredLots.slice(0, RENDER_CAP);
  const selectedSet = useMemo(() => new Set(orderedIds), [orderedIds]);

  const toggleLot = (id: string) => {
    setOrderedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    setOrderedIds((prev) => Array.from(new Set([...prev, ...visibleLots.map((l) => l.id)])));
  };

  const selectAllFiltered = () => {
    setOrderedIds((prev) => Array.from(new Set([...prev, ...filteredLots.map((l) => l.id)])));
  };

  const clearSelection = () => setOrderedIds([]);

  const selectedLots = useMemo(
    () => orderedIds.map((id) => lots.find((l) => l.id === id)).filter((l): l is Lot => !!l),
    [orderedIds, lots]
  );

  const beginEntry = () => {
    const init: Record<string, string> = {};
    const saved = new Set<string>();
    selectedLots.forEach((l) => {
      init[l.id] = valuationToText(l);
      if (init[l.id]) saved.add(l.id);
    });
    setValues(init);
    setSavedIds(saved);
    setErrors({});
    setStep("enter");
    setTimeout(() => {
      const first = selectedLots.find((l) => !saved.has(l.id)) ?? selectedLots[0];
      if (first) inputRefs.current[first.id]?.focus();
    }, 50);
  };

  const focusRow = (index: number) => {
    const lot = selectedLots[index];
    if (lot) inputRefs.current[lot.id]?.focus();
  };

  const commit = async (lot: Lot, index: number) => {
    const parsed = parseValuationInput(values[lot.id] ?? "");
    setErrors((e) => {
      const next = { ...e };
      delete next[lot.id];
      return next;
    });

    if (parsed.kind === "error") {
      setErrors((e) => ({ ...e, [lot.id]: parsed.message }));
      return;
    }

    const patch =
      parsed.kind === "clear"
        ? { valuationSingle: null, valuationFrom: null, valuationTo: null }
        : parsed.kind === "single"
          ? { valuationSingle: parsed.value, valuationFrom: null, valuationTo: null }
          : { valuationSingle: null, valuationFrom: parsed.from, valuationTo: parsed.to };

    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setSavedIds((s) => new Set(s).add(lot.id));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    focusRow(index + 1);
  };

  const filledCount = savedIds.size;

  if (!activeCatalogueId) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Valuation Centre</h1>
        <p className="text-[13px] text-text-muted">Load a catalogue from Catalogue Manager first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Valuation Centre</h1>
          <p className="text-[13px] text-text-muted m-0">
            {activeCatalogue?.sourceName} · {step === "select" ? "Step 1 — choose lots" : "Step 2 — enter valuations"}
          </p>
        </div>
        <Button variant="outlined" size="small" onClick={() => router.push("/catalogue")}>
          Back to Catalogue Manager
        </Button>
      </div>

      {loading && <p className="text-text-muted text-sm">Loading lots…</p>}

      {!loading && step === "select" && (
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <TextField
              placeholder="Search lot no, grade, mark, selling mark, broker, category…"
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ width: 360 }}
            />
            <Button size="small" variant="outlined" onClick={selectAllVisible}>
              Select shown ({visibleLots.length})
            </Button>
            {filteredLots.length > visibleLots.length && (
              <Button size="small" variant="outlined" onClick={selectAllFiltered}>
                Select all matching ({filteredLots.length})
              </Button>
            )}
            <Button size="small" onClick={clearSelection} disabled={orderedIds.length === 0}>
              Clear
            </Button>
            <span className="text-[12.5px] text-text-muted font-mono ml-auto">{orderedIds.length.toLocaleString()} selected</span>
          </div>

          <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto border border-border rounded-md p-1.5 mb-4">
            {visibleLots.map((lot) => (
              <label
                key={lot.id}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded hover:bg-surface-alt cursor-pointer"
              >
                <Checkbox checked={selectedSet.has(lot.id)} onChange={() => toggleLot(lot.id)} size="small" />
                <span className="text-[13px] text-text">{lotLabel(lot)}</span>
                {sellingMarkOf(lot) && <span className="text-[11px] text-text-muted">SM: {sellingMarkOf(lot)}</span>}
                {noOfChestsOf(lot) && <span className="text-[11px] text-text-muted">Chests: {noOfChestsOf(lot)}</span>}
                <span className="text-[11.5px] text-text-muted ml-auto font-mono">
                  {formatCurrency(lot.valuation?.valuationSingle ?? lot.valuation?.valuationFrom ?? null)}
                </span>
              </label>
            ))}
            {filteredLots.length > RENDER_CAP && (
              <p className="text-[11.5px] text-text-muted text-center py-2">
                Showing first {RENDER_CAP} matches — refine your search to see more, or use &ldquo;Select all matching&rdquo;.
              </p>
            )}
            {filteredLots.length === 0 && <p className="text-[12.5px] text-text-muted text-center py-6">No lots match your search.</p>}
          </div>

          <Button variant="contained" disabled={orderedIds.length === 0} onClick={beginEntry}>
            Continue with {orderedIds.length} lot{orderedIds.length === 1 ? "" : "s"} →
          </Button>
        </div>
      )}

      {!loading && step === "enter" && (
        <div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <Button variant="text" size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => setStep("select")}>
              Change selection
            </Button>
            {activeCatalogueId && (
              <ExportShareMenu catalogueId={activeCatalogueId} catalogueName={activeCatalogue?.sourceName ?? "Catalogue"} lots={selectedLots} />
            )}
            <span className="text-[12.5px] text-text-muted font-mono ml-auto">
              {filledCount} / {selectedLots.length} filled
            </span>
          </div>
          <LinearProgress variant="determinate" value={(filledCount / Math.max(selectedLots.length, 1)) * 100} sx={{ mb: 2 }} />
          <p className="text-[12px] text-text-muted mb-3">
            Type a single value (e.g. <span className="font-mono">1000</span>) or a range (e.g.{" "}
            <span className="font-mono">1000-1100</span>) — it&apos;s detected automatically. All values are in{" "}
            <strong>LKR</strong>. Press <strong>Enter</strong> to save and move to the next lot; leave blank + Enter to
            clear a value. Every entry auto-saves — safe to leave anytime.
          </p>

          <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {selectedLots.map((lot, index) => {
              const saved = savedIds.has(lot.id);
              const error = errors[lot.id];
              const sellingMark = sellingMarkOf(lot);
              const noOfChests = noOfChestsOf(lot);
              const weightPerChest = weightPerChestOf(lot);
              return (
                <div
                  key={lot.id}
                  className="flex items-center gap-3 px-3 py-2 rounded border"
                  style={{ borderColor: error ? "var(--danger)" : "var(--border)", background: "var(--surface)" }}
                >
                  <div className="w-8 flex justify-center shrink-0">
                    {saved ? (
                      <CheckCircleIcon sx={{ fontSize: 18, color: "var(--sage)" }} />
                    ) : (
                      <span className="text-[11px] text-text-muted font-mono">{index + 1}</span>
                    )}
                  </div>
                  <div className="w-[220px] shrink-0 text-[12.5px] text-text truncate" title={lotLabel(lot)}>
                    {lotLabel(lot)}
                  </div>
                  <div className="w-[220px] shrink-0 flex flex-col gap-0.5 text-[10.5px] text-text-muted leading-tight">
                    {sellingMark && <span className="truncate" title={sellingMark}>Selling Mark: {sellingMark}</span>}
                    {(noOfChests || weightPerChest) && (
                      <span className="truncate">
                        {noOfChests ? `Chests: ${noOfChests}` : ""}
                        {noOfChests && weightPerChest ? " · " : ""}
                        {weightPerChest ? `Wt/Chest: ${weightPerChest}` : ""}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-[11px] text-text-muted font-mono shrink-0">Rs.</span>
                    <input
                      ref={(el) => {
                        inputRefs.current[lot.id] = el;
                      }}
                      type="text"
                      inputMode="decimal"
                      placeholder="1000 or 1000-1100"
                      className="flex-1 max-w-[220px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent font-mono"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                      value={values[lot.id] ?? ""}
                      disabled={savingId === lot.id}
                      onChange={(e) => setValues((v) => ({ ...v, [lot.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commit(lot, index);
                        }
                      }}
                    />
                  </div>

                  {error && <span className="text-[11px] text-danger shrink-0">{error}</span>}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end mt-4">
            <Button variant="contained" onClick={() => router.push("/catalogue")}>
              Done — back to Catalogue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
