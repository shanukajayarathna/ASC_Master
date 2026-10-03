"use client";

import { MotionConfig } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";

/**
 * "Lite mode" for low-end PCs: ASC's visual polish (blurs, glows, parallax, looping animations)
 * is GPU/CPU-heavy on integrated graphics. LITE_MODE_SCRIPT runs in <head> before first paint and
 * sets `data-lite` on <html> when the device looks weak (<=4 logical cores, <=4 GB RAM, Save-Data,
 * or the user's own `asc_lite` override in localStorage: "1" forces on, "0" forces off).
 * globals.css then strips the expensive effects, and <LiteMotion> turns off motion transforms.
 */
export const LITE_MODE_SCRIPT = `(function(){try{var o=localStorage.getItem("asc_lite");var n=navigator;var c=n.connection;var lite=o==="1"||(o!=="0"&&((n.hardwareConcurrency&&n.hardwareConcurrency<=4)||(n.deviceMemory&&n.deviceMemory<=4)||(c&&c.saveData)));if(lite)document.documentElement.setAttribute("data-lite","")}catch(e){}})();`;

const subscribe = () => () => {};
const isLite = () => document.documentElement.hasAttribute("data-lite");

/** True when lite mode is active (false during SSR/hydration, so markup always matches). */
export function useLiteMode(): boolean {
  return useSyncExternalStore(subscribe, isLite, () => false);
}

/** Disables motion's transform/layout animations app-wide while lite mode is on. */
export function LiteMotion({ children }: { children: ReactNode }) {
  const lite = useLiteMode();
  return <MotionConfig reducedMotion={lite ? "always" : "user"}>{children}</MotionConfig>;
}
