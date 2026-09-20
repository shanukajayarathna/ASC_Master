"use client";

import { useEffect, useRef } from "react";
import type { LevelSource } from "./voice";
import "./voice-orb.css";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export const ORB_STATES: readonly OrbState[] = ["idle", "listening", "thinking", "speaking"];

export const ORB_COPY: Record<OrbState, { title: string; hint: string }> = {
  idle: { title: "Ready", hint: "Type a question, or press the mic and speak." },
  listening: { title: "Listening", hint: "Go ahead — your words appear in the box for review." },
  thinking: { title: "Thinking", hint: "Working on it against the sale and archive data." },
  speaking: { title: "Speaking", hint: "Reading the answer aloud. Press Stop to interrupt." },
};

interface VoiceOrbProps {
  state: OrbState;
  /** Polled every frame while listening / speaking; drives the core's size and the equaliser. */
  getLevel?: LevelSource;
  /** Reduced motion: hold a still frame (the state's colour still changes). */
  reduced?: boolean;
}

const BARS = 9;

/**
 * The shared voice orb: a rotating dashed outer ring, a counter-rotating inner ring and a breathing core,
 * with an equaliser beneath. Each state has its own colour, glow and tempo (set as CSS variables in
 * voice-orb.css). While listening or speaking it follows real audio levels, written straight to a CSS
 * variable from a rAF so a 60 fps signal never re-renders React.
 */
export default function VoiceOrb({ state, getLevel, reduced = false }: VoiceOrbProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || !getLevel || (state !== "listening" && state !== "speaking")) {
      el.style.setProperty("--lvl", "0");
      return;
    }
    let raf = 0;
    const tick = () => {
      el.style.setProperty("--lvl", getLevel().toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [state, getLevel, reduced]);

  return (
    <div ref={ref} className="voice-orb" data-state={state} data-reduced={reduced ? "true" : "false"} aria-hidden="true">
      <svg viewBox="0 0 200 200" className="voice-orb-svg" focusable="false">
        <circle className="voice-ring voice-ring-outer" cx="100" cy="100" r="92" />
        <circle className="voice-ring voice-ring-inner" cx="100" cy="100" r="72" />
      </svg>
      <div className="voice-core" />
      <div className="voice-eq">
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} style={{ ["--i" as string]: i }} />
        ))}
      </div>
    </div>
  );
}
