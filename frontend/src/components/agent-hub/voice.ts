"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A level source the orb polls each frame: 0 (silent) to 1 (loud). */
export type LevelSource = () => number;

/** The speech language the mic chip stores (MicButton); speech out follows the same choice. */
export const VOICE_LANG_KEY = "asc_mic_lang";

export function readVoiceLang(): string {
  try {
    return window.localStorage.getItem(VOICE_LANG_KEY) || "en-US";
  } catch {
    return "en-US";
  }
}

/** Turns a chat reply into something worth reading aloud: no charts, tables, links or markdown marks. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Microphone level while `active`, measured with a Web Audio AnalyserNode. The stream is opened only while
 * listening and always released, so the browser's recording indicator goes away with the state. If the
 * microphone can't be opened a second time (some browsers only allow one consumer) the level stays at a
 * gentle constant so the orb still reads as "listening" rather than dead.
 */
export function useMicLevel(active: boolean): LevelSource {
  const level = useRef(0);
  const opened = useRef(false);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    level.current = 0.25;
    opened.current = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) return;
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        opened.current = true;
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          // RMS is small for speech; scale so normal talking fills most of the range.
          level.current = Math.min(1, Math.sqrt(sum / data.length) * 4);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* keep the constant fallback level */
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      level.current = 0;
    };
  }, [active]);

  return useCallback(() => level.current, []);
}

/**
 * Speech out through the browser's speech synthesis. The browser gives no audio stream to analyse, so the
 * orb's "speaking" level is driven by word-boundary events (pulsing on each word, decaying between) with a
 * steady floor while speech is playing.
 */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [missingVoice, setMissingVoice] = useState<string | null>(null);
  const pulse = useRef(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only feature check
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    const clean = speakable(text);
    if (!clean) return;
    const tag = readVoiceLang();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = tag;
    // No voice for this language installed (common for Sinhala/Tamil): say so instead of staying silent.
    const voices = window.speechSynthesis.getVoices();
    const hasVoice = voices.length === 0 || voices.some((v) => v.lang.toLowerCase().startsWith(tag.slice(0, 2).toLowerCase()));
    setMissingVoice(hasVoice ? null : tag);
    utterance.onstart = () => setSpeaking(true);
    utterance.onboundary = () => {
      pulse.current = 1;
    };
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const getLevel = useCallback<LevelSource>(() => {
    pulse.current *= 0.9;
    return 0.3 + pulse.current * 0.6;
  }, []);

  return { supported, speaking, speak, cancel, getLevel, missingVoice };
}

/** Web Speech recognition, minimally typed (the DOM lib doesn't ship it; Chromium-only, prefixed). */
interface RecognitionLike {
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

const recognitionCtor = (): (new () => RecognitionLike) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission was denied — allow it in your browser to use voice.",
  "service-not-allowed": "Microphone permission was denied — allow it in your browser to use voice.",
  "no-speech": "Didn't hear anything — hold the button while you speak.",
  "audio-capture": "No microphone found on this device.",
  "language-not-supported": "Speech recognition isn't available for that language in this browser.",
};

/**
 * Hold-to-speak: `start()` on press, `stop()` on release, and the words arrive once through `onTranscript`
 * (never auto-run — the caller shows them for review). Reports unsupported browsers and every failure in plain
 * words instead of a dead button.
 */
export function useHoldToSpeak(onTranscript: (text: string) => void) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const cb = useRef(onTranscript);
  useEffect(() => {
    cb.current = onTranscript;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only feature check
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    setError(null);
    const r = new Ctor();
    rec.current = r;
    r.lang = readVoiceLang();
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0]?.transcript ?? "").join(" ").trim();
      if (text) cb.current(text);
      else setError("Didn't catch anything — try again closer to the microphone.");
    };
    r.onerror = (e) => setError(RECOGNITION_ERRORS[e.error] ?? "Voice input failed — you can type instead.");
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError("Couldn't start the microphone — you can type instead.");
    }
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported, listening, error, start, stop };
}
