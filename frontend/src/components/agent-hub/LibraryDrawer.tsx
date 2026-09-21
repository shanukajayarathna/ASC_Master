"use client";

import { api } from "@/lib/api";
import type { ReportSpec } from "@/types/api";
import CloseIcon from "@mui/icons-material/Close";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "next/link";
import { useEffect, useState } from "react";
import PinnedBoard from "./PinnedBoard";
import type { Pin } from "./pins";
import "./workspace.css";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "not run yet");

interface LibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  pins: Pin[];
  onUnpin: (id: string) => void;
  /** Sends a question to the chat (and the drawer closes so the answer is visible). */
  onAsk: (question: string) => void;
  busy: boolean;
}

/** What you have kept: pinned insights, weekly scheduled reports, and the way to Saved Reports. Out of the way until asked for. */
export default function LibraryDrawer({ open, onClose, pins, onUnpin, onAsk, busy }: LibraryDrawerProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "min(100vw, 440px)", maxWidth: "100vw" } }} slotProps={{ paper: { "aria-label": "Library" } }}>
      {open && <LibraryBody onClose={onClose} pins={pins} onUnpin={onUnpin} onAsk={(q) => { onAsk(q); onClose(); }} busy={busy} />}
    </Drawer>
  );
}

function LibraryBody({ onClose, pins, onUnpin, onAsk, busy }: Omit<LibraryDrawerProps, "open">) {
  const [specs, setSpecs] = useState<ReportSpec[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listReportSpecs().then((s) => !cancelled && setSpecs(s)).catch(() => !cancelled && setSpecs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const removeSpec = async (spec: ReportSpec) => {
    setError(null);
    try {
      await api.deleteReportSpec(spec.id);
      setSpecs((s) => (s ?? []).filter((x) => x.id !== spec.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that.");
    }
  };

  return (
    <div className="ws-library workspace" data-agent="general">
      <header className="ws-canvas-head">
        <h2 className="ws-canvas-title">Library</h2>
        <IconButton onClick={onClose} aria-label="Close the library" sx={{ width: 44, height: 44 }}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="ws-library-body">
        <PinnedBoard pins={pins} onUnpin={onUnpin} onAsk={onAsk} busy={busy} />

        <section className="ws-board" aria-label="Scheduled reports">
          <h2 className="ws-lots-title">Scheduled reports</h2>
          {specs === null ? (
            <p className="ws-lots-note" role="status">Loading…</p>
          ) : specs.length === 0 ? (
            <p className="ws-lots-note">Nothing scheduled. Open a report in the report canvas and choose “Schedule weekly”.</p>
          ) : (
            <ul className="ws-deck-list" aria-label="Your scheduled reports">
              {specs.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.title}
                    <br />
                    <em className="ws-lots-note">Every Monday · last run {when(s.lastRunAt)}{s.lastError ? ` — ${s.lastError}` : ""}</em>
                  </span>
                  <Button size="small" onClick={() => removeSpec(s)} aria-label={`Stop scheduling ${s.title}`} sx={{ minHeight: 36 }}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="ws-lots-note ws-lots-error" role="alert">{error}</p>}
        </section>

        <p className="ws-lots-note">
          <Link href="/saved-reports" className="ws-out-link">Open Saved Reports</Link> for every snapshot, deck and scheduled result.
        </p>
        <p className="ws-lots-note">
          Prefer the original chat, with history and manual agent choice? <Link href="/assistant/classic" className="ws-out-link">Open the classic chat</Link>.
        </p>
      </div>
    </div>
  );
}
