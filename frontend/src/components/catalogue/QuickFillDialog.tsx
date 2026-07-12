"use client";

import { api } from "@/lib/api";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import type { ClassificationValue, Lot } from "@/types/api";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import LinearProgress from "@mui/material/LinearProgress";
import { useEffect, useMemo, useRef, useState } from "react";

export type QuickFillField =
  | "valuation"
  | "classification"
  | "standardData"
  | "adjectiveData"
  | "liquorRemarks"
  | "musterReport"
  | "brokerNotes"
  | "privateNotes";

const FIELD_TABS: { value: QuickFillField; label: string }[] = [
  { value: "valuation", label: "Valuation" },
  { value: "classification", label: "Classification" },
  { value: "standardData", label: "Standard Data" },
  { value: "adjectiveData", label: "Adjective Data" },
  { value: "liquorRemarks", label: "Liquor Remarks" },
  { value: "musterReport", label: "Muster Report" },
  { value: "brokerNotes", label: "Broker Notes" },
  { value: "privateNotes", label: "Private Notes" },
];

const CLASSIFICATIONS: { value: ClassificationValue; label: string; key: string; color: string }[] = [
  { value: "Best", label: "Best (1)", key: "1", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best (2)", key: "2", color: "var(--warn)" },
  { value: "Poor", label: "Poor (3)", key: "3", color: "var(--danger)" },
];

function currentTextValue(lot: Lot, field: QuickFillField): string {
  const v = lot.valuation;
  if (!v) return "";
  switch (field) {
    case "valuation":
      return v.valuationSingle?.toString() ?? v.valuationFrom?.toString() ?? "";
    case "standardData":
      return v.standardData ?? "";
    case "adjectiveData":
      return v.adjectiveData ?? "";
    case "liquorRemarks":
      return v.liquorRemarks ?? "";
    case "musterReport":
      return v.musterReport ?? "";
    case "brokerNotes":
      return v.brokerNotes ?? "";
    case "privateNotes":
      return v.privateNotes ?? "";
    default:
      return "";
  }
}

function lotLabel(lot: Lot): string {
  return [lot.lotNumber ? `Lot ${lot.lotNumber}` : null, lot.grade, lot.garden].filter(Boolean).join(" · ") || lot.rowKey;
}

export default function QuickFillDialog({
  open,
  lots,
  initialField,
  onClose,
  onLotUpdated,
}: {
  open: boolean;
  lots: Lot[];
  initialField: QuickFillField;
  onClose: () => void;
  onLotUpdated: (updated: Lot) => void;
}) {
  const [field, setField] = useState<QuickFillField>(initialField);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!open) return;
    setField(initialField);
  }, [open, initialField]);

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    const saved = new Set<string>();
    lots.forEach((l) => {
      init[l.id] = currentTextValue(l, field);
      if (init[l.id]) saved.add(l.id);
    });
    setValues(init);
    setSavedIds(saved);
    setErrors({});
    // Focus the first not-yet-filled row (or the first row) once the dialog paints.
    const target = lots.find((l) => !saved.has(l.id)) ?? lots[0];
    setTimeout(() => target && inputRefs.current[target.id]?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field, lots.map((l) => l.id).join(",")]);

  const filledCount = savedIds.size;

  const focusRow = (index: number) => {
    const lot = lots[index];
    if (lot) inputRefs.current[lot.id]?.focus();
  };

  const commitText = async (lot: Lot, index: number) => {
    const raw = (values[lot.id] ?? "").trim();

    if (field === "valuation") {
      if (raw !== "") {
        const num = Number(raw);
        if (Number.isNaN(num) || num < 0) {
          setErrors((e) => ({ ...e, [lot.id]: "Enter a valid positive number" }));
          return;
        }
      }
    }
    setErrors((e) => {
      const next = { ...e };
      delete next[lot.id];
      return next;
    });

    setSavingId(lot.id);
    try {
      const patch =
        field === "valuation"
          ? { valuationSingle: raw === "" ? null : Number(raw), valuationFrom: null, valuationTo: null }
          : { [field]: raw === "" ? null : raw };
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      onLotUpdated(updated);
      setSavedIds((s) => new Set(s).add(lot.id));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    focusRow(index + 1);
  };

  const commitClassification = async (lot: Lot, index: number, value: ClassificationValue) => {
    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { classification: value }));
      onLotUpdated(updated);
      setSavedIds((s) => new Set(s).add(lot.id));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    focusRow(index + 1);
  };

  const isTextArea = field === "liquorRemarks" || field === "musterReport";
  const isValuation = field === "valuation";
  const isClassification = field === "classification";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle className="flex items-center justify-between !pb-1">
        <span>Quick Fill</span>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <div className="px-6">
        <Tabs
          value={field}
          onChange={(_, v) => setField(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, fontSize: 12.5, textTransform: "none" } }}
        >
          {FIELD_TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      </div>
      <LinearProgress variant="determinate" value={(filledCount / Math.max(lots.length, 1)) * 100} />

      <DialogContent className="!pt-4">
        <p className="text-[12px] text-text-muted mb-3">
          {isValuation
            ? "Enter a single estimated value per lot, then press Enter to move to the next lot. Need a From/To range for one lot? Use its edit icon in the table instead."
            : isClassification
              ? "Click a classification (or press 1 / 2 / 3) to set it and jump to the next lot."
              : "Type a value and press Enter to save it and move to the next lot. Leave blank + Enter to skip."}
          {" "}
          <span className="font-mono">
            {filledCount} / {lots.length} filled
          </span>
        </p>

        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
          {lots.map((lot, index) => {
            const saved = savedIds.has(lot.id);
            const error = errors[lot.id];
            return (
              <div
                key={lot.id}
                className="flex items-center gap-3 px-3 py-2 rounded border"
                style={{ borderColor: error ? "var(--danger)" : "var(--border)", background: "var(--surface)" }}
              >
                <div className="w-8 flex justify-center">
                  {saved ? (
                    <CheckCircleIcon sx={{ fontSize: 18, color: "var(--sage)" }} />
                  ) : (
                    <span className="text-[11px] text-text-muted font-mono">{index + 1}</span>
                  )}
                </div>
                <div className="w-[220px] shrink-0 text-[12.5px] text-text truncate" title={lotLabel(lot)}>
                  {lotLabel(lot)}
                </div>

                {isClassification ? (
                  <div className="flex gap-1.5">
                    {CLASSIFICATIONS.map((c) => (
                      <button
                        key={c.value}
                        ref={(el) => {
                          if (c.value === "Best") inputRefs.current[lot.id] = el;
                        }}
                        type="button"
                        disabled={savingId === lot.id}
                        onClick={() => commitClassification(lot, index, c.value)}
                        onKeyDown={(e) => {
                          if (e.key === "1") commitClassification(lot, index, "Best");
                          if (e.key === "2") commitClassification(lot, index, "BelowBest");
                          if (e.key === "3") commitClassification(lot, index, "Poor");
                        }}
                        className="px-3 py-1 rounded-full text-[11.5px] font-semibold border-[1.5px]"
                        style={{
                          borderColor: lot.valuation?.classification === c.value ? c.color : "var(--border)",
                          background: lot.valuation?.classification === c.value ? c.color : "transparent",
                          color: lot.valuation?.classification === c.value ? "#fff" : "var(--text-muted)",
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                ) : isTextArea ? (
                  <input
                    ref={(el) => {
                      inputRefs.current[lot.id] = el;
                    }}
                    className="flex-1 px-2.5 py-1.5 rounded border text-[13px] bg-transparent"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    value={values[lot.id] ?? ""}
                    disabled={savingId === lot.id}
                    onChange={(e) => setValues((v) => ({ ...v, [lot.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitText(lot, index);
                      }
                    }}
                  />
                ) : (
                  <input
                    ref={(el) => {
                      inputRefs.current[lot.id] = el;
                    }}
                    type={isValuation ? "number" : "text"}
                    className="flex-1 px-2.5 py-1.5 rounded border text-[13px] bg-transparent font-mono"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    value={values[lot.id] ?? ""}
                    disabled={savingId === lot.id}
                    onChange={(e) => setValues((v) => ({ ...v, [lot.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitText(lot, index);
                      }
                    }}
                  />
                )}

                {error && <span className="text-[11px] text-danger shrink-0">{error}</span>}
              </div>
            );
          })}
        </div>
      </DialogContent>
      <DialogActions>
        <span className="text-[11.5px] text-text-muted mr-auto ml-2">Every entry auto-saves — safe to close anytime.</span>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
