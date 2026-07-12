"use client";

import { formatCurrency } from "@/lib/format";
import type { Lot } from "@/types/api";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";

const CLASSIFICATION_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  SelectBest: { label: "Select Best", bg: "var(--brass-dim)", fg: "var(--brass)" },
  Best: { label: "Best", bg: "var(--sage-light)", fg: "var(--sage-dark)" },
  BelowBest: { label: "Below Best", bg: "var(--warn-light)", fg: "var(--warn)" },
  Poor: { label: "Poor", bg: "var(--danger-light)", fg: "var(--danger)" },
  Unclassified: { label: "Unclassified", bg: "var(--surface-sunken)", fg: "var(--text-muted)" },
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-text-muted font-mono mb-1">{label}</div>
      <div className="text-[13px] text-text whitespace-pre-wrap">{value?.trim() ? value : <span className="text-text-muted">Not yet recorded</span>}</div>
    </div>
  );
}

export default function LotViewDialog({
  lot,
  open,
  onClose,
  onEdit,
}: {
  lot: Lot | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  if (!lot) return null;
  const v = lot.valuation;
  const cls = CLASSIFICATION_STYLE[v?.classification ?? "Unclassified"];
  const value = v?.valuationSingle ?? (v?.valuationFrom != null && v?.valuationTo != null ? (v.valuationFrom + v.valuationTo) / 2 : v?.valuationFrom) ?? null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <div className="px-6 pt-5 pb-4 relative" style={{ background: "linear-gradient(180deg, var(--ink-900), var(--ink-800))" }}>
        <IconButton onClick={onClose} size="small" className="!absolute !top-3.5 !right-3.5 !text-white">
          <CloseIcon fontSize="small" />
        </IconButton>
        <p className="font-mono text-xs text-brass-light tracking-wide m-0">
          LOT {lot.lotNumber ?? "—"}
          {lot.invoiceNo ? ` · INV ${lot.invoiceNo}` : ""}
        </p>
        <h2 className="font-display text-xl font-bold my-1 text-white">{lot.mark || lot.lotNumber || "Lot"}</h2>
        <p className="text-xs text-white/65 m-0">{[lot.broker, lot.grade, lot.garden].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="px-6 py-5 max-h-[65vh] overflow-y-auto">
        <p className="font-display text-[13.5px] font-semibold text-liquor mb-3">Catalogue Data</p>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2 mb-5 pb-4 border-b border-dashed border-border">
          {Object.entries(lot.rawData).map(([k, val]) => (
            <div key={k}>
              <div className="text-[10px] uppercase tracking-wide text-text-muted">{k}</div>
              <div className="font-mono text-[12.5px] text-text font-semibold break-words">{val || "—"}</div>
            </div>
          ))}
        </div>

        <p className="font-display text-[13.5px] font-semibold text-liquor mb-3">Valuation &amp; Remarks</p>
        <div className="flex items-center gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-text-muted font-mono mb-1">Valuation</div>
            <div className="font-mono text-lg font-semibold text-text-strong">{formatCurrency(value)}</div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={{ background: cls.bg, color: cls.fg }}>
            {cls.label}
          </span>
        </div>
        <Field label="Standard Data" value={v?.standardData} />
        <Field label="Adjective Data" value={v?.adjectiveData} />
        <Field label="Liquor Remarks" value={v?.liquorRemarks} />
        <Field label="Muster Report" value={v?.musterReport} />
        <Field label="Broker Notes" value={v?.brokerNotes} />
        <Field label="Private Notes" value={v?.privateNotes} />
        <p className="text-[11px] text-text-muted mt-2">
          {v?.updatedAt ? `Last saved ${new Date(v.updatedAt).toLocaleString()}` : "Not yet saved"}
        </p>
      </div>

      <div className="px-6 py-3.5 border-t border-border flex justify-end gap-2.5">
        <Button variant="outlined" onClick={onClose}>
          Close
        </Button>
        <Button variant="contained" startIcon={<EditIcon fontSize="small" />} onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Dialog>
  );
}
