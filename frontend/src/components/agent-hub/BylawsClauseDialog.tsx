"use client";

import { api } from "@/lib/api";
import type { BylawsClause } from "@/types/api";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { useEffect, useState } from "react";
import { RichText } from "@/components/assistant/RichText";

/** Opens the by-laws section an answer cited, so the reader can check the clause itself. */
export default function BylawsClauseDialog({ title, onClose }: { title: string | null; onClose: () => void }) {
  const [clause, setClause] = useState<BylawsClause | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!title) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a newly opened clause starts a fresh load
    setClause(null);
    setError(null);
    api
      .getBylawsClause(title)
      .then((c) => !cancelled && setClause(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load that clause."));
    return () => {
      cancelled = true;
    };
  }, [title]);

  return (
    <Dialog open={title !== null} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="bylaws-title">
      <DialogTitle id="bylaws-title">CTTA By-Laws · {title}</DialogTitle>
      <DialogContent dividers>
        {!clause && !error && <p className="m-0 text-[13px] text-text-muted" role="status">Loading the clause…</p>}
        {error && <p className="m-0 text-[13px] text-danger" role="alert">{error}</p>}
        {clause && (
          <>
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap"><RichText text={clause.text} /></div>
            <p className="mt-3 mb-0 text-[12px] text-text-muted">{clause.caveat}{clause.lastVerified ? ` Last verified ${clause.lastVerified}.` : ""}</p>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
