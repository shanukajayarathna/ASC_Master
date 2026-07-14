"use client";

import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { hasValuation, lotLabel, noOfChestsOf, sellingMarkOf, valuationToText, weightPerChestOf } from "@/lib/lotDisplay";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import { parseValuationInput, valuationTypingFeedback, VALUATION_MAX, VALUATION_MIN } from "@/lib/valuationInput";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const PENDING_KEY = "asc:valuation:pending";

const CLASSIFICATIONS: { value: ClassificationValue; label: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", color: "var(--brass)" },
  { value: "Best", label: "Best", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", color: "var(--warn)" },
  { value: "Poor", label: "Poor", color: "var(--danger)" },
];

export default function ValuationCentrePage() {
  const router = useRouter();
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [handoffIds, setHandoffIds] = useState<Set<string>>(new Set());
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

  // Consume a one-shot handoff from the Catalogue Manager's "Valuation…" button — any lots
  // selected there get added to this page's working set alongside whatever's already valued.
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
      setHandoffIds((prev) => new Set([...prev, ...validIds]));
    } catch {
      // ignore malformed handoff payload
    }
  }, [activeCatalogueId, lots]);

  // The working set is everything already valued, plus anything just handed off from the
  // Catalogue Manager that still needs a value — in the catalogue's natural (lot) order.
  const displayedLots = useMemo(
    () => lots.filter((l) => hasValuation(l) || handoffIds.has(l.id)),
    [lots, handoffIds]
  );

  // Seed the text field for any newly-displayed lot without clobbering one the user is
  // already mid-edit on — an additive merge, not a full derive, so an effect is the right tool.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      displayedLots.forEach((l) => {
        if (next[l.id] === undefined) {
          next[l.id] = valuationToText(l);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSavedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      displayedLots.forEach((l) => {
        if (hasValuation(l) && !next.has(l.id)) {
          next.add(l.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [displayedLots]);

  const focusRow = (index: number) => {
    const lot = displayedLots[index];
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
      setSavedIds((s) => {
        const next = new Set(s);
        if (parsed.kind === "clear") next.delete(lot.id);
        else next.add(lot.id);
        return next;
      });
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    focusRow(index + 1);
  };

  // Classification saves instantly on click — clicking the active tier again clears it.
  const commitClassification = async (lot: Lot, value: ClassificationValue) => {
    const current = lot.valuation?.classification ?? "Unclassified";
    const next: ClassificationValue = current === value ? "Unclassified" : value;
    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { classification: next }));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
    } finally {
      setSavingId(null);
    }
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
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Valuation Centre</h1>
          <p className="text-[13px] text-text-muted m-0">
            {activeCatalogue?.sourceName} · {displayedLots.length.toLocaleString()} lot{displayedLots.length === 1 ? "" : "s"} ·
            values in <strong>LKR</strong>
          </p>
        </div>
        <div className="flex gap-2">
          {activeCatalogueId && displayedLots.length > 0 && (
            <ExportShareMenu catalogueId={activeCatalogueId} catalogueName={activeCatalogue?.sourceName ?? "Catalogue"} lots={displayedLots} />
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddCircleOutlineIcon fontSize="small" />}
            onClick={() => router.push("/catalogue")}
          >
            Add more lots
          </Button>
        </div>
      </div>

      {loading && <p className="text-text-muted text-sm mt-4">Loading lots…</p>}

      {!loading && displayedLots.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No lots valued yet</h3>
          <p className="mb-4">Go to Catalogue Manager, select the lots you want to value, then use its &ldquo;Valuation…&rdquo; button.</p>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddCircleOutlineIcon fontSize="small" />}
            onClick={() => router.push("/catalogue")}
          >
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {!loading && displayedLots.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[12.5px] text-text-muted font-mono">
              {filledCount} / {displayedLots.length} filled
            </span>
            <LinearProgress
              variant="determinate"
              value={(filledCount / Math.max(displayedLots.length, 1)) * 100}
              sx={{ flex: 1, height: 6, borderRadius: 3 }}
            />
          </div>
          <p className="text-[12px] text-text-muted mb-3">
            Type a single value (e.g. <span className="font-mono">1250</span>) or a range (e.g.{" "}
            <span className="font-mono">1200-1350</span>) — it&apos;s detected automatically. Valuations are always
            4-digit values (<span className="font-mono">{VALUATION_MIN}</span>–<span className="font-mono">{VALUATION_MAX}</span>),
            and in a range the first number must be lower than the second. Press <strong>Enter</strong> to save and move to
            the next row; leave blank + Enter to clear. Click a tier to classify — click it again to unset.
          </p>

          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ maxHeight: "68vh", borderColor: "var(--border)" }}
          >
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {["#", "Lot", "Selling Mark", "Chests", "Wt/Chest (kg)", "Classification", "Valuation (LKR)", "Status"].map(
                    (h) => (
                      <TableCell
                        key={h}
                        sx={{
                          bgcolor: "var(--liquor)",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 11.5,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </TableCell>
                    )
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedLots.map((lot, index) => {
                  const saved = savedIds.has(lot.id);
                  const error = errors[lot.id];
                  const currentCls = lot.valuation?.classification ?? "Unclassified";
                  const text = values[lot.id] ?? "";
                  // Live feedback only while the text differs from what's already saved —
                  // settled rows stay quiet.
                  const feedback = !error && text !== valuationToText(lot) ? valuationTypingFeedback(text) : null;
                  return (
                    <TableRow
                      key={lot.id}
                      hover
                      sx={{
                        "&:nth-of-type(even)": { bgcolor: "var(--surface-alt)" },
                        ...(error && { outline: "1.5px solid var(--danger)", outlineOffset: "-1.5px" }),
                        ...(saved && !error && { borderLeft: "3px solid var(--sage)" }),
                      }}
                    >
                      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
                        {index + 1}
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{lotLabel(lot)}</TableCell>
                      <TableCell sx={{ fontSize: 12.5 }}>{sellingMarkOf(lot) ?? "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{noOfChestsOf(lot) ?? "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{weightPerChestOf(lot) ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {CLASSIFICATIONS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              disabled={savingId === lot.id}
                              onClick={() => commitClassification(lot, c.value)}
                              title={currentCls === c.value ? "Click again to unset" : `Mark as ${c.label}`}
                              className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold border-[1.5px] cursor-pointer whitespace-nowrap"
                              style={{
                                borderColor: currentCls === c.value ? c.color : "var(--border)",
                                background: currentCls === c.value ? c.color : "transparent",
                                color: currentCls === c.value ? "#fff" : "var(--text-muted)",
                              }}
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-text-muted font-mono shrink-0">Rs.</span>
                          <input
                            ref={(el) => {
                              inputRefs.current[lot.id] = el;
                            }}
                            type="text"
                            inputMode="numeric"
                            placeholder="1250 or 1200-1350"
                            className="w-[160px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent font-mono"
                            style={{ borderColor: error ? "var(--danger)" : "var(--border)", color: "var(--text)" }}
                            value={text}
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
                        {error && <span className="text-[10.5px] text-danger block mt-0.5">{error}</span>}
                        {feedback && feedback.tone !== "none" && (
                          <span
                            className="text-[10.5px] block mt-0.5"
                            style={{ color: feedback.tone === "ok" ? "var(--sage-dark)" : "var(--text-muted)" }}
                          >
                            {feedback.tone === "ok" ? "✓ " : ""}
                            {feedback.message}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {saved ? (
                          <CheckCircleIcon sx={{ fontSize: 18, color: "var(--sage)" }} />
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </div>
  );
}
