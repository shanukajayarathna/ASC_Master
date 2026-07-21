"use client";

import { api } from "@/lib/api";
import IconButton from "@mui/material/IconButton";
import MicNoneIcon from "@mui/icons-material/MicNone";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { useEffect, useRef, useState } from "react";

interface VoiceRecorderProps {
  lotId: string;
  /** The remark field this note belongs to (e.g. "standardData"). */
  field: string;
  has: boolean;
  version: number;
  onChanged: () => void;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Record a short voice note for one remark field (standard / adjectives / remarks / liquor)
 * instead of typing — tap to record, tap to stop (it saves), play it back, or delete it.
 * Uses the browser's MediaRecorder; the recorded blob is stored on the API behind the same
 * DB-swappable media seam as photos. Needs mic permission (works on localhost and HTTPS).
 */
export default function VoiceRecorder({ lotId, field, has, version, onChanged }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  // Play back from a same-origin object URL (fetched blob) rather than a cross-origin
  // <audio src> — the latter doesn't play MediaRecorder webm reliably.
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
  };

  // Stop (and discard) any in-progress recording when the lot changes or on unmount, so a
  // note never lands on the wrong lot.
  useEffect(() => {
    return () => {
      if (recorder.current && recorder.current.state !== "inactive") {
        discard.current = true;
        recorder.current.stop();
      }
      cleanup();
    };
  }, [lotId]);

  // Load (or clear) the playable blob URL whenever the note appears/changes for this lot.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayUrl(null);
    if (has) {
      api
        .fetchVoiceBlob(lotId, field)
        .then((b) => {
          if (cancelled) return;
          url = URL.createObjectURL(b);
          setPlayUrl(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [lotId, field, has, version]);

  const start = async () => {
    setErr(null);
    const targetLot = lotId;
    const targetField = field;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      discard.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        const wasDiscarded = discard.current;
        const blob = new Blob(chunks.current, { type: mime || "audio/webm" });
        cleanup();
        if (wasDiscarded || blob.size === 0) return;
        setBusy(true);
        try {
          await api.uploadVoice(targetLot, targetField, blob);
          onChanged();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Voice upload failed.");
        } finally {
          setBusy(false);
        }
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((v) => v + 1), 1000);
    } catch {
      cleanup();
      setErr("Microphone unavailable — allow mic access.");
    }
  };

  const stop = () => {
    discard.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteVoice(lotId, field);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the voice note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap min-h-[30px]">
      {recording ? (
        <button
          type="button"
          onClick={stop}
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold cursor-pointer touch-manipulation"
          style={{ background: "var(--danger)", color: "var(--paper-0)" }}
        >
          <StopCircleIcon sx={{ fontSize: 15 }} />
          Stop · {mmss(elapsed)}
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          title={has ? "Record a new voice note (replaces the current one)" : "Record a voice note"}
          className="flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-semibold cursor-pointer touch-manipulation disabled:opacity-50"
          style={{ borderColor: "var(--brass)", color: "var(--text-strong)", background: "transparent" }}
        >
          <MicNoneIcon sx={{ fontSize: 15 }} />
          {busy ? "Saving…" : has ? "Re-record" : "Record"}
        </button>
      )}

      {has && !recording && (
        <>
          {playUrl ? (
            <audio controls src={playUrl} className="h-8" style={{ maxWidth: 168 }} />
          ) : (
            <span className="text-[10.5px] text-text-muted">loading…</span>
          )}
          <IconButton size="small" onClick={remove} disabled={busy} aria-label="Delete voice note">
            <DeleteOutlineIcon sx={{ fontSize: 16, color: "var(--danger)" }} />
          </IconButton>
        </>
      )}

      {err && <span className="text-[10px] text-danger w-full">{err}</span>}
    </div>
  );
}
