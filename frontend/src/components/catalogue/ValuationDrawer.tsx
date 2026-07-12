"use client";

import { api } from "@/lib/api";
import type { ClassificationValue, Lot } from "@/types/api";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CloseIcon from "@mui/icons-material/Close";
import { useState } from "react";

const CLASSIFICATIONS: { value: ClassificationValue; label: string; color: string }[] = [
  { value: "Best", label: "Best", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", color: "var(--warn)" },
  { value: "Poor", label: "Poor", color: "var(--danger)" },
];

interface FormState {
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

  const fromNum = parseFloat(form.valuationFrom);
  const toNum = parseFloat(form.valuationTo);
  const rangeError = !Number.isNaN(fromNum) && !Number.isNaN(toNum) && fromNum > toNum;

  const title = lot.mark || lot.lotNumber || "Lot";

  const save = async () => {
    if (rangeError) return;
    setSaving(true);
    try {
      const updated = await api.updateValuation(lot.id, {
        valuationFrom: form.valuationFrom ? parseFloat(form.valuationFrom) : null,
        valuationTo: form.valuationTo ? parseFloat(form.valuationTo) : null,
        valuationSingle: form.valuationSingle ? parseFloat(form.valuationSingle) : null,
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
        style={{ background: "linear-gradient(180deg, var(--ink-900), var(--ink-800))" }}
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

        <p className="font-display text-[13.5px] font-semibold text-liquor mb-3">Valuation</p>
        <div className="flex gap-2.5 mb-2">
          <TextField
            label="From"
            size="small"
            type="number"
            fullWidth
            value={form.valuationFrom}
            error={rangeError}
            onChange={(e) => setForm((f) => ({ ...f, valuationFrom: e.target.value }))}
          />
          <TextField
            label="To"
            size="small"
            type="number"
            fullWidth
            value={form.valuationTo}
            error={rangeError}
            onChange={(e) => setForm((f) => ({ ...f, valuationTo: e.target.value }))}
          />
        </div>
        {rangeError && (
          <p className="text-danger text-[11.5px] mb-2">&quot;From&quot; must be less than or equal to &quot;To&quot;.</p>
        )}
        <TextField
          label="Single value (if no range)"
          size="small"
          type="number"
          fullWidth
          className="!mb-4"
          value={form.valuationSingle}
          onChange={(e) => setForm((f) => ({ ...f, valuationSingle: e.target.value }))}
        />

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
                color: form.classification === c.value ? "#fff" : "var(--text-muted)",
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
        <Button variant="contained" onClick={save} disabled={saving || rangeError}>
          {saving ? "Saving…" : "Save Ticket"}
        </Button>
      </div>
    </div>
  );
}
