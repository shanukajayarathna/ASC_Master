"use client";

import { api } from "@/lib/api";
import type { CustomPreview, CustomPreviewRequest, ReportSpec } from "@/types/api";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { VisualKey } from "./reportBuilder";

interface ScheduleCardProps {
  preview: CustomPreview | null;
  /** The builder's current query and visual — what gets re-run each week. */
  request: CustomPreviewRequest;
  visual: VisualKey;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "not run yet");

/** Schedule the report on screen to be re-run every Monday and saved under Saved Reports; manage your schedules. */
export default function ScheduleCard({ preview, request, visual }: ScheduleCardProps) {
  const [specs, setSpecs] = useState<ReportSpec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listReportSpecs().then((s) => !cancelled && setSpecs(s)).catch(() => !cancelled && setSpecs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const schedule = async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const spec = await api.createReportSpec(preview.title, request, visual);
      setSpecs((s) => [spec, ...(s ?? [])]);
      setMessage({ text: "Scheduled — it will be saved every Monday morning." });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Couldn't schedule that.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (spec: ReportSpec) => {
    setMessage(null);
    try {
      await api.deleteReportSpec(spec.id);
      setSpecs((s) => (s ?? []).filter((x) => x.id !== spec.id));
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Couldn't remove that.", error: true });
    }
  };

  return (
    <section className="ws-out" aria-label="Schedule">
      <h3 className="ws-out-title">Schedule</h3>
      <p className="ws-lots-note">Re-run this report every Monday and keep the result under Saved Reports.</p>
      <Button variant="outlined" disabled={!preview || busy} onClick={schedule} sx={{ minHeight: 44 }}>
        {busy ? "Scheduling…" : "Schedule weekly"}
      </Button>

      {specs && specs.length > 0 && (
        <ul className="ws-deck-list" aria-label="Your scheduled reports">
          {specs.map((s) => (
            <li key={s.id}>
              <span>
                {s.title}
                <br />
                <em className="ws-lots-note">Last run: {when(s.lastRunAt)}{s.lastError ? ` — ${s.lastError}` : ""}</em>
              </span>
              <Button size="small" onClick={() => remove(s)} aria-label={`Stop scheduling ${s.title}`} sx={{ minHeight: 36 }}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="ws-lots-note" role="status" aria-live="polite" style={message?.error ? { color: "var(--danger)" } : undefined}>
        {message?.text} {specs && specs.length > 0 && !message?.error && <Link href="/saved-reports" className="ws-out-link">Saved Reports</Link>}
      </p>
    </section>
  );
}
