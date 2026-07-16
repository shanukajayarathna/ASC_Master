"use client";

import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { lotLabel, noOfChestsOf, sellingMarkOf, weightPerChestOf } from "@/lib/lotDisplay";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const PENDING_KEY = "asc:worksheet:pending";

export type WorksheetField =
  | "classification"
  | "standardData"
  | "adjectiveData"
  | "liquorRemarks"
  | "musterReport"
  | "brokerNotes"
  | "privateNotes";

const FIELD_DEFS: { value: WorksheetField; label: string; hint: string }[] = [
  { value: "classification", label: "Classification", hint: "Click a tier — or press 1 / 2 / 3 / 4 — to set it and jump to the next lot." },
  { value: "standardData", label: "Standard Data", hint: "Type the standard data and press Enter to save and move on." },
  { value: "adjectiveData", label: "Adjective Data", hint: "Type the adjective data and press Enter to save and move on." },
  { value: "liquorRemarks", label: "Taster's Remarks", hint: "Type the taster's (liquor) remarks and press Enter to save and move on." },
  { value: "musterReport", label: "Muster Report", hint: "Type the muster report and press Enter to save and move on." },
  { value: "brokerNotes", label: "Broker Notes", hint: "Type the broker notes and press Enter to save and move on." },
  { value: "privateNotes", label: "Private Notes", hint: "Type your private notes and press Enter to save and move on." },
];

const CLASSIFICATIONS: { value: ClassificationValue; label: string; key: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", key: "1", color: "var(--brass)" },
  { value: "Best", label: "Best", key: "2", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", key: "3", color: "var(--warn)" },
  { value: "Poor", label: "Poor", key: "4", color: "var(--danger)" },
];

function fieldText(lot: Lot, field: WorksheetField): string {
  if (field === "classification") return "";
  return lot.valuation?.[field] ?? "";
}

function hasField(lot: Lot, field: WorksheetField): boolean {
  if (field === "classification") return (lot.valuation?.classification ?? "Unclassified") !== "Unclassified";
  return !!lot.valuation?.[field]?.trim();
}

function effectiveValuation(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle !== null) return v.valuationSingle;
  if (v.valuationFrom !== null && v.valuationTo !== null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom;
}

export default function WorksheetPage() {
  const router = useRouter();
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [field, setField] = useState<WorksheetField>("classification");
  const [handoffIds, setHandoffIds] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLElement | null>>({});

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

  // Consume a one-shot handoff from the Catalogue Manager's "Work on selection…" menu — the
  // chosen section and the selected lots arrive together.
  useEffect(() => {
    if (!activeCatalogueId || lots.length === 0) return;
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(PENDING_KEY);
    try {
      const pending = JSON.parse(raw) as { catalogueId: string; lotIds: string[]; field: WorksheetField };
      if (pending.catalogueId !== activeCatalogueId) return;
      const validIds = pending.lotIds.filter((id) => lots.some((l) => l.id === id));
      // One-shot handoff consumed inside an effect by design — not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (FIELD_DEFS.some((f) => f.value === pending.field)) setField(pending.field);
      if (validIds.length > 0) setHandoffIds((prev) => new Set([...prev, ...validIds]));
    } catch {
      // ignore malformed handoff payload
    }
  }, [activeCatalogueId, lots]);

  // The working set is everything that already has this field filled, plus anything just
  // handed off from the Catalogue Manager — in the catalogue's natural (lot) order.
  const displayedLots = useMemo(
    () => lots.filter((l) => hasField(l, field) || handoffIds.has(l.id)),
    [lots, field, handoffIds]
  );

  // Seed the text field for any newly-displayed lot without clobbering one the user is
  // already mid-edit on — an additive merge, not a full derive, so an effect is the right tool.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      displayedLots.forEach((l) => {
        const key = `${field}:${l.id}`;
        if (next[key] === undefined) {
          next[key] = fieldText(l, field);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [displayedLots, field]);

  const switchField = (next: WorksheetField) => {
    setField(next);
    setErrors({});
  };

  const focusRow = (index: number) => {
    const lot = displayedLots[index];
    if (lot) inputRefs.current[lot.id]?.focus();
  };

  const saveLot = async (lot: Lot, patch: Parameters<typeof buildValuationUpdate>[1], index: number) => {
    setErrors((e) => {
      const next = { ...e };
      delete next[lot.id];
      return next;
    });
    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    focusRow(index + 1);
  };

  const commitText = (lot: Lot, index: number) => {
    const raw = (values[`${field}:${lot.id}`] ?? "").trim();
    if (field === "classification") return;
    saveLot(lot, { [field]: raw === "" ? null : raw }, index);
  };

  const commitClassification = (lot: Lot, index: number, value: ClassificationValue) => {
    saveLot(lot, { classification: value }, index);
  };

  const fieldDef = FIELD_DEFS.find((f) => f.value === field)!;
  const filledCount = displayedLots.filter((l) => hasField(l, field)).length;

  if (!activeCatalogueId) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Lot Worksheet</h1>
        <p className="text-[13px] text-text-muted">Load a catalogue from Catalogue Manager first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Lot Worksheet — {fieldDef.label}</h1>
          <p className="text-[13px] text-text-muted m-0">
            {activeCatalogue?.sourceName} · {displayedLots.length.toLocaleString()} lot{displayedLots.length === 1 ? "" : "s"}
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

      <Tabs
        value={field}
        onChange={(_, v) => switchField(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 36, mb: 1.5, "& .MuiTab-root": { minHeight: 36, fontSize: 12.5, textTransform: "none" } }}
      >
        {FIELD_DEFS.map((f) => (
          <Tab key={f.value} value={f.value} label={f.label} />
        ))}
      </Tabs>

      {loading && <p className="text-text-muted text-sm mt-4">Loading lots…</p>}

      {!loading && displayedLots.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No lots in this worksheet yet</h3>
          <p className="mb-4">
            Go to Catalogue Manager, select the lots you want, then choose &ldquo;{fieldDef.label}&rdquo; from its
            &ldquo;Work on selection&rdquo; menu.
          </p>
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
        <div>
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
          <p className="text-[12px] text-text-muted mb-3">{fieldDef.hint} Every entry auto-saves — safe to leave anytime.</p>

          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "66vh", borderColor: "var(--border)" }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {["#", "Lot", "Selling Mark", "Chests", "Wt/Chest (kg)", "Valuation (LKR)", fieldDef.label, "Status"].map((h) => (
                    <TableCell
                      key={h}
                      sx={{
                        bgcolor: "var(--liquor)",
                        color: "var(--paper-0)",
                        fontWeight: 700,
                        fontSize: 11.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {displayedLots.map((lot, index) => {
                  const saved = hasField(lot, field);
                  const error = errors[lot.id];
                  const current = lot.valuation?.classification ?? "Unclassified";
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
                      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>
                        {formatCurrency(effectiveValuation(lot))}
                      </TableCell>
                      <TableCell>
                        {field === "classification" ? (
                          <div
                            className="flex gap-1.5 flex-wrap"
                            ref={(el) => {
                              inputRefs.current[lot.id] = el;
                            }}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              const match = CLASSIFICATIONS.find((c) => c.key === e.key);
                              if (match) commitClassification(lot, index, match.value);
                            }}
                          >
                            {CLASSIFICATIONS.map((c) => (
                              <button
                                key={c.value}
                                type="button"
                                disabled={savingId === lot.id}
                                onClick={() => commitClassification(lot, index, c.value)}
                                title={`Press ${c.key}`}
                                className="px-2.5 py-1 rounded-full text-[11px] font-semibold border-[1.5px] cursor-pointer"
                                style={{
                                  borderColor: current === c.value ? c.color : "var(--border)",
                                  background: current === c.value ? c.color : "transparent",
                                  color: current === c.value ? "var(--paper-0)" : "var(--text-muted)",
                                }}
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <input
                            ref={(el) => {
                              inputRefs.current[lot.id] = el;
                            }}
                            type="text"
                            placeholder={fieldDef.label}
                            className="w-[240px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent"
                            style={{ borderColor: error ? "var(--danger)" : "var(--border)", color: "var(--text)" }}
                            value={values[`${field}:${lot.id}`] ?? ""}
                            disabled={savingId === lot.id}
                            onChange={(e) => setValues((v) => ({ ...v, [`${field}:${lot.id}`]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitText(lot, index);
                              }
                            }}
                          />
                        )}
                        {error && <span className="text-[10.5px] text-danger block mt-0.5">{error}</span>}
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
