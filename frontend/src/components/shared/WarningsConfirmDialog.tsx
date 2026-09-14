"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";

/** Shared "this looks off — cancel or proceed?" checkpoint for report inputs that parsed with
 *  warnings (skipped rows, missing sections, unrecognized brokers, ...). Same shape reused by
 *  Weekly FACT, Worksheet, Asking Price and Sharing Mark Catalogued Summary, so the gate reads
 *  the same everywhere instead of four slightly different ad hoc dialogs. */
export default function WarningsConfirmDialog({
  open,
  title = "Review before continuing",
  warnings,
  busy = false,
  confirmLabel = "Continue anyway",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  warnings: string[];
  busy?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={() => (busy ? null : onCancel())} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent>
        <p className="text-[13px] text-text m-0 mb-2">
          {warnings.length === 1 ? "1 issue was found:" : `${warnings.length} issues were found:`}
        </p>
        <ul className="text-[13px] text-text-muted m-0 pl-5 flex flex-col gap-1">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="warning" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
