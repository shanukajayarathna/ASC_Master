"use client";

import { api } from "@/lib/api";
import { valuationValueError, VALUATION_MAX, VALUATION_MIN } from "@/lib/valuationInput";
import type { ClassificationValue, Lot } from "@/types/api";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import CloseIcon from "@mui/icons-material/Close";
import { useState } from "react";

const CLASSIFICATIONS: { value: ClassificationValue; label: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", color: "var(--brass)" },
  { value: "Best", label: "Best", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", color: "var(--warn)" },
  { value: "Poor", label: "Poor", color: "var(--danger)" },
];

type ValuationMode = "single" | "range";

interface FormState {
  mode: ValuationMode;
  valuationFrom: string;
  valuationTo: string;
  valuationSingle: string;
  classification: ClassificationValue;
  standardData: string;
  adjectiveData: string;
  liquorRemarks: string;
  musterReport: string;
  brokerNotes: string;
  privateNotes: string;
}

function formFromLot(lot: Lot): FormState {
  const v = lot.valuation;
  return {
    mode: v?.valuationFrom != null || v?.valuationTo != null ? "range" : "single",
    valuationFrom: v?.valuationFrom?.toString() ?? "",
    valuationTo: v?.valuationTo?.toString() ?? "",
    valuationSingle: v?.valuationSingle?.toString() ?? "",
    classification: v?.classification ?? "Unclassified",
    standardData: v?.standardData ?? "",
    adjectiveData: v?.adjectiveData ?? "",
    liquorRemarks: v?.liquorRemarks ?? "",
    musterReport: v?.musterReport ?? "",
    brokerNotes: v?.brokerNotes ?? "",
    privateNotes: v?.privateNotes ?? "",
  };
}

export default function ValuationDrawer({
  lot,
  open,
  onClose,
  onSaved,
}: {
  lot: Lot | null;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Lot) => void;
}) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      {lot && (
        // Remounting per-lot (instead of an effect that resets form state on prop change)
        // lets the form initialize its state directly from the lot via useState's initializer.
        <ValuationDrawerContent key={lot.id} lot={lot} onClose={onClose} onSaved={onSaved} />
      )}
    </Drawer>
  );
}

function ValuationDrawerContent({
  lot,
  onClose,
  onSaved,
}: {
  lot: Lot;
  onClose: () => void;
  onSaved: (updated: Lot) => void;
}) {
  const [form, setForm] = useState<FormState>(() => formFromLot(lot));
  const [saving, setSaving] = useState(false);

  // Per-field validation: every entered value must be a whole LKR value in range, and a
  // range's first number must be strictly lower than its second. Empty fields are fine —
  // that just means "no valuation yet" (or a cleared one).
  const fieldError = (raw: string): string | null => (raw.trim() === "" ? null : valuationValueError(Number(raw)));
  const singleError = form.mode === "single" ? fieldError(form.valuationSingle) : null;
  const fromError = form.mode === "range" ? fieldError(form.valuationFrom) : null;
  const toError = form.mode === "range" ? fieldError(form.valuationTo) : null;
  const rangeHalfMissing =
    form.mode === "range" && (form.valuationFrom.trim() === "") !== (form.valuationTo.trim() === "");
  const rangeOrderError =
    form.mode === "range" &&
    !fromError &&
    !toError &&
    form.valuationFrom.trim() !== "" &&
    form.valuationTo.trim() !== "" &&
    Number(form.valuationFrom) >= Number(form.valuationTo);
  const hasError = !!singleError || !!fromError || !!toError || rangeHalfMissing || rangeOrderError;

  const title = lot.mark || lot.lotNumber || "Lot";

  const save = async () => {
    if (hasError) return;
    setSaving(true);
    try {
      const updated = await api.updateValuation(lot.id, {
        valuationFrom: form.mode === "range" && form.valuationFrom.trim() ? Number(form.valuationFrom) : null,
        valuationTo: form.mode === "range" && form.valuationTo.trim() ? Number(form.valuationTo) : null,
        valuationSingle: form.mode === "single" && form.valuationSingle.trim() ? Number(form.valuationSingle) : null,
        classification: form.classification,
        standardData: form.standardData || null,
        adjectiveData: form.adjectiveData || null,
        liquorRemarks: form.liquorRemarks || null,
        musterReport: form.musterReport || null,
        brokerNotes: form.brokerNotes || null,
        privateNotes: form.privateNotes || null,
      });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-[min(560px,100vw)] h-full flex flex-col bg-surface-alt">
      <div
        className="px-6 pt-5 pb-4 text-white relative"
        style={{ background: "linear-gradient(180deg, var(--ink-solid-900), var(--ink-solid-800))" }}
      >
        <IconButton onClick={onClose} size="small" className="!absolute !top-3.5 !right-3.5 !text-white">
          <CloseIcon fontSize="small" />
        </IconButton>
        <p className="font-mono text-xs text-brass-light tracking-wide m-0">
          LOT {lot.lotNumber ?? "—"}
          {lot.invoiceNo ? ` · INV ${lot.invoiceNo}` : ""}
        </p>
        <h2 className="font-display text-xl font-bold my-1">{title}</h2>
        <p className="text-xs text-white/65 m-0">{[lot.broker, lot.grade, lot.garden].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="font-display text-[13.5px] font-semibold text-liquor mb-3">Catalogue Data</p>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2 mb-5 pb-4 border-b border-dashed border-border max-h-[210px] overflow-y-auto">
          {Object.entries(lot.rawData).map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">{k}</div>
              <div className="font-mono text-[12.5px] text-text font-semibold break-words">{v || "—"}</div>
            </div>
          ))}
        </div>

        <p className="font-display text-[13.5px] font-semibold text-liquor mb-1.5">Valuation</p>
        <p className="text-[11.5px] text-text-muted mb-2.5">
          Always a whole value in LKR ({VALUATION_MIN}–{VALUATION_MAX}). Pick single value or a range.
        </p>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={form.mode}
          onChange={(_, mode: ValuationMode | null) => {
            if (mode) setForm((f) => ({ ...f, mode }));
          }}
          className="!mb-3"
          sx={{ "& .MuiToggleButton-root": { px: 2, py: 0.5, fontSize: 12, textTransform: "none" } }}
        >
          <ToggleButton value="single">Single value</ToggleButton>
          <ToggleButton value="range">Range</ToggleButton>
        </ToggleButtonGroup>

        {form.mode === "single" ? (
          <TextField
            label="Value (Rs.)"
            size="small"
            fullWidth
            className="!mb-4"
            placeholder="e.g. 1250"
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            value={form.valuationSingle}
            error={!!singleError}
            helperText={singleError ?? " "}
            onChange={(e) => setForm((f) => ({ ...f, valuationSingle: e.target.value }))}
          />
        ) : (
          <>
            <div className="flex gap-2.5">
              <TextField
                label="From (lower)"
                size="small"
                fullWidth
                placeholder="e.g. 1200"
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                value={form.valuationFrom}
                error={!!fromError || rangeOrderError || rangeHalfMissing}
                helperText={fromError ?? " "}
                onChange={(e) => setForm((f) => ({ ...f, valuationFrom: e.target.value }))}
              />
              <TextField
                label="To (higher)"
                size="small"
                fullWidth
                placeholder="e.g. 1350"
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                value={form.valuationTo}
                error={!!toError || rangeOrderError || rangeHalfMissing}
                helperText={toError ?? " "}
                onChange={(e) => setForm((f) => ({ ...f, valuationTo: e.target.value }))}
              />
            </div>
            {rangeOrderError && (
              <p className="text-danger text-[11.5px] mb-2">The first number must be lower than the second.</p>
            )}
            {rangeHalfMissing && (
              <p className="text-danger text-[11.5px] mb-2">Enter both ends of the range (or clear both).</p>
            )}
            <div className="mb-2" />
          </>
        )}

        <p className="font-display text-[13.5px] font-semibold text-liquor mb-2 mt-4">Classification</p>
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {CLASSIFICATIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setForm((f) => ({ ...f, classification: f.classification === c.value ? "Unclassified" : c.value }))}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold border-[1.5px] transition-colors"
              style={{
                borderColor: form.classification === c.value ? c.color : "var(--border)",
                background: form.classification === c.value ? c.color : "var(--surface)",
                color: form.classification === c.value ? "var(--paper-0)" : "var(--text-muted)",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <p className="font-display text-[13.5px] font-semibold text-liquor mb-3">Taster&apos;s Remarks</p>
        <div className="flex flex-col gap-3.5 mb-2">
          <TextField
            label="Standard Data"
            size="small"
            fullWidth
            value={form.standardData}
            onChange={(e) => setForm((f) => ({ ...f, standardData: e.target.value }))}
          />
          <TextField
            label="Adjective Data"
            size="small"
            fullWidth
            value={form.adjectiveData}
            onChange={(e) => setForm((f) => ({ ...f, adjectiveData: e.target.value }))}
          />
          <TextField
            label="Liquor Remarks"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={form.liquorRemarks}
            onChange={(e) => setForm((f) => ({ ...f, liquorRemarks: e.target.value }))}
          />
          <TextField
            label="Muster Report"
            size="small"
            fullWidth
            multiline
            minRows={3}
            value={form.musterReport}
            onChange={(e) => setForm((f) => ({ ...f, musterReport: e.target.value }))}
          />
          <TextField
            label="Broker Notes"
            size="small"
            fullWidth
            value={form.brokerNotes}
            onChange={(e) => setForm((f) => ({ ...f, brokerNotes: e.target.value }))}
          />
          <TextField
            label="Private Notes"
            size="small"
            fullWidth
            value={form.privateNotes}
            onChange={(e) => setForm((f) => ({ ...f, privateNotes: e.target.value }))}
          />
        </div>
      </div>

      <div className="px-6 py-3.5 border-t border-border flex items-center gap-2.5 bg-surface-alt">
        <span className="text-[11px] text-text-muted mr-auto">
          {lot.valuation?.updatedAt ? `Last saved ${new Date(lot.valuation.updatedAt).toLocaleString()}` : "Not yet saved"}
        </span>
        <Button variant="outlined" onClick={onClose}>
          Close
        </Button>
        <Button variant="contained" onClick={save} disabled={saving || hasError}>
          {saving ? "Saving…" : "Save Ticket"}
        </Button>
      </div>
    </div>
  );
}
