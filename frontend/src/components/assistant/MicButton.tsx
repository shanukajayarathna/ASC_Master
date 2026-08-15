"use client";

import KeyboardVoiceOutlinedIcon from "@mui/icons-material/KeyboardVoiceOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

/** Web Speech API shims — TypeScript's DOM lib doesn't ship these (still vendor-prefixed
 *  in Chromium, absent in Firefox), so the shapes are declared minimally here. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Speech-recognition languages offered — cycled by tapping the chip next to the mic.
 *  Whether recognition actually works in each depends on the browser/OS speech provider;
 *  we pass the tag and surface any failure honestly rather than promising recognition. */
const MIC_LANGS = [
  { tag: "en-US", label: "EN" },
  { tag: "si-LK", label: "සිං" },
  { tag: "ta-LK", label: "த" },
] as const;

const MIC_LANG_KEY = "asc_mic_lang";

/**
 * Voice input for the assistant (docs/29 Phase 4): press → speak → transcript lands in the
 * INPUT FIELD for review — never auto-sent. States are always visible (idle / listening /
 * error), permission and provider failures degrade to a plain message, and an unsupported
 * browser (e.g. Firefox) shows a disabled mic with an explanation instead of a dead button.
 */
export default function MicButton({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langIdx, setLangIdx] = useState(0);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    const stored = window.localStorage.getItem(MIC_LANG_KEY);
    const idx = MIC_LANGS.findIndex((l) => l.tag === stored);
    if (idx >= 0) setLangIdx(idx);
    return () => recRef.current?.abort();
  }, []);

  const cycleLang = () => {
    const next = (langIdx + 1) % MIC_LANGS.length;
    setLangIdx(next);
    window.localStorage.setItem(MIC_LANG_KEY, MIC_LANGS[next].tag);
  };

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);

    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = MIC_LANGS[langIdx].tag;
    rec.interimResults = false;
    rec.continuous = false;

    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) onTranscript(transcript);
      else setError("Didn't catch anything — try again closer to the microphone.");
    };
    rec.onerror = (e) => {
      setListening(false);
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone permission was denied — allow it in your browser to use voice input."
          : e.error === "no-speech"
            ? "Didn't hear anything — try again."
            : e.error === "audio-capture"
              ? "No microphone found on this device."
              : e.error === "language-not-supported"
                ? `${MIC_LANGS[langIdx].label} speech recognition isn't available in this browser — try another language.`
                : "Voice input failed — you can type instead.");
    };
    rec.onend = () => setListening(false);

    try {
      rec.start();
      setListening(true);
    } catch {
      setError("Couldn't start the microphone — you can type instead.");
    }
  };

  if (!supported) {
    return (
      <Tooltip title="Voice input isn't supported in this browser — Chrome or Edge support it.">
        <span>
          <IconButton disabled aria-label="Voice input unavailable">
            <KeyboardVoiceOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  return (
    <span className="flex items-center gap-0.5">
      {/* recognition-language chip — EN / සිං / த, remembered per browser */}
      <button
        type="button"
        onClick={cycleLang}
        title={`Voice language: ${MIC_LANGS[langIdx].tag} — tap to change`}
        aria-label={`Voice input language ${MIC_LANGS[langIdx].tag}, tap to change`}
        className="px-1.5 py-0.5 rounded-full border border-border text-[10.5px] font-semibold cursor-pointer"
        style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
      >
        {MIC_LANGS[langIdx].label}
      </button>

      <Tooltip
        title={
          error ??
          (listening ? "Listening… tap to stop" : "Speak your question — the text appears in the box for you to review")
        }
        open={error ? true : undefined}
        onClose={() => setError(null)}
      >
        <IconButton
          onClick={listening ? stop : start}
          disabled={disabled}
          aria-label={listening ? "Stop listening" : "Start voice input"}
          sx={{ color: listening ? "var(--danger)" : "var(--liquor)" }}
        >
          {listening ? <StopCircleOutlinedIcon fontSize="small" /> : <KeyboardVoiceOutlinedIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      {listening && (
        <span className="text-[11px] font-semibold" style={{ color: "var(--danger)" }} aria-live="polite">
          ● Listening…
        </span>
      )}
    </span>
  );
}
