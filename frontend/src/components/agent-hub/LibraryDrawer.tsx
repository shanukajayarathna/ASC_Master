"use client";

import { api } from "@/lib/api";
import type { AssistantPreferences, ReportSpec } from "@/types/api";
import CloseIcon from "@mui/icons-material/Close";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
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
  /** Called after a settings change or clearing history, so the empty screen can refresh. */
  onPersonalisationChanged?: () => void;
  onHistoryCleared?: () => void;
}

const BROKERS = ["ASC", "BC", "CT", "EB", "FW", "JK", "LC", "MPB"];

/** What you have kept: pinned insights, weekly scheduled reports, and the way to Saved Reports. Out of the way until asked for. */
export default function LibraryDrawer({ open, onClose, pins, onUnpin, onAsk, busy, onPersonalisationChanged, onHistoryCleared }: LibraryDrawerProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "min(100vw, 440px)", maxWidth: "100vw" } }} slotProps={{ paper: { "aria-label": "Library" } }}>
      {open && <LibraryBody onClose={onClose} pins={pins} onUnpin={onUnpin} onAsk={(q) => { onAsk(q); onClose(); }} busy={busy} onPersonalisationChanged={onPersonalisationChanged} onHistoryCleared={onHistoryCleared} />}
    </Drawer>
  );
}

function LibraryBody({ onClose, pins, onUnpin, onAsk, busy, onPersonalisationChanged, onHistoryCleared }: Omit<LibraryDrawerProps, "open">) {
  const [specs, setSpecs] = useState<ReportSpec[] | null>(null);
  const [prefs, setPrefs] = useState<AssistantPreferences | null>(null);
  const [prefNote, setPrefNote] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getAssistantPreferences().then((p) => !cancelled && setPrefs(p)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const savePrefs = async (next: AssistantPreferences) => {
    const previous = prefs;
    setPrefs(next);
    setPrefNote(null);
    try {
      setPrefs(await api.putAssistantPreferences(next));
      onPersonalisationChanged?.();
    } catch (e) {
      if (previous) setPrefs(previous);
      setPrefNote({ text: e instanceof Error ? e.message : "Couldn't save that.", error: true });
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Delete all your assistant conversations? Pins, saved reports and schedules are kept. This can't be undone.")) return;
    setPrefNote(null);
    try {
      await api.clearAssistantHistory();
      setPrefNote({ text: "Your conversation history was deleted." });
      onPersonalisationChanged?.();
      onHistoryCleared?.();
    } catch (e) {
      setPrefNote({ text: e instanceof Error ? e.message : "Couldn't delete your history.", error: true });
    }
  };

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

        <section className="ws-board" aria-label="Personalisation">
          <h2 className="ws-lots-title">Personalisation</h2>
          <p className="ws-lots-note">Greets you by name and offers your own recent questions. Uses only your own history.</p>
          <FormControlLabel
            control={<Switch checked={prefs?.personalise ?? true} disabled={!prefs} onChange={(e) => prefs && void savePrefs({ ...prefs, personalise: e.target.checked })} />}
            label="Personalise the assistant for me"
            sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
          />
          <label className="ws-scope-field">
            <span>My broker (what “we” and “our” mean)</span>
            <Select size="small" value={prefs?.myBroker ?? "ASC"} disabled={!prefs} onChange={(e) => prefs && void savePrefs({ ...prefs, myBroker: e.target.value })} inputProps={{ "aria-label": "My broker" }} sx={{ minWidth: 140 }}>
              {BROKERS.map((b) => (
                <MenuItem key={b} value={b} sx={{ minHeight: 40 }}>{b}</MenuItem>
              ))}
            </Select>
          </label>
          <Button size="small" variant="outlined" color="error" onClick={clearHistory} sx={{ minHeight: 40, alignSelf: "flex-start" }}>
            Clear my conversation history
          </Button>
          {prefNote && <p className="ws-lots-note" role={prefNote.error ? "alert" : "status"} style={prefNote.error ? { color: "var(--danger)" } : undefined}>{prefNote.text}</p>}
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
