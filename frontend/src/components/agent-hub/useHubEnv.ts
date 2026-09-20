"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Below this width the tiles stack (General first), tilt is off and the heavy effects are dropped. */
export const COMPACT_QUERY = "(max-width: 899px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Where in an animation's timeline a reduced-motion visual is frozen — a mid-loop frame that reads well. */
export const REDUCED_FRAME_SECONDS = 2.2;

function subscribeMedia(query: string, onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** A media query as React state. `false` on the server and until hydrated, so markup matches the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(query, cb),
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery(REDUCED_MOTION_QUERY);
export const useIsCompact = () => useMediaQuery(COMPACT_QUERY);

/**
 * True while `ref` is on screen. Animations pause when it is not — a tile scrolled out of view
 * should cost nothing. Environments without IntersectionObserver (old browsers, jsdom) count as
 * always visible rather than always paused.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.05): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return inView;
}

/**
 * Runs or pauses an SVG's SMIL animations. `run` false pauses them; `frozenFrame` additionally jumps to
 * a fixed frame so a paused (reduced-motion) visual shows a composed still, not whatever moment it
 * happened to stop on. Guarded: jsdom has no SMIL API.
 */
export function useSvgAnimation(svgRef: RefObject<SVGSVGElement | null>, run: boolean, frozenFrame = false) {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    if (run) {
      svg.unpauseAnimations();
      return;
    }
    if (frozenFrame) svg.setCurrentTime(REDUCED_FRAME_SECONDS);
    svg.pauseAnimations();
  }, [svgRef, run, frozenFrame]);
}
