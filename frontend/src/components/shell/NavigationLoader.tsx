"use client";

import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useEffect, useRef, useState } from "react";

// Only shown if a navigation is still in flight after this long — most transitions (a
// prefetched tile, an already-visited route) resolve well under this, so the loader would
// otherwise just flash uselessly.
const SHOW_DELAY_MS = 150;
// Once shown, stays up at least this long — without this a navigation that finishes just
// after the delay above would pop in and immediately vanish, reading as a glitch.
const MIN_VISIBLE_MS = 350;

/** The Navigation API isn't in TypeScript's bundled DOM lib yet, despite shipping in every
 *  browser this app targets — this is just the minimal shape used below. */
interface NavigateEventLike extends Event {
  navigationType: "push" | "replace" | "reload" | "traverse";
  canIntercept: boolean;
}
interface NavigationLike extends EventTarget {
  addEventListener(type: "navigate", listener: (event: NavigateEventLike) => void): void;
  addEventListener(type: "navigatesuccess" | "navigateerror", listener: () => void): void;
  removeEventListener(type: "navigate", listener: (event: NavigateEventLike) => void): void;
  removeEventListener(type: "navigatesuccess" | "navigateerror", listener: () => void): void;
}

/**
 * One global loading overlay for every client-side navigation in the app — clicking a
 * launchpad tile, a nav link, a command-palette result, the browser back button, all of it.
 *
 * Built on the standards-based Navigation API (`window.navigation`), not a monkey-patch of
 * history.pushState/replaceState. That was the first approach here, and it doesn't work:
 * Next's own App Router already wraps those two calls internally for its own routing (its
 * patched history.pushState carries a source comment referencing this exact API), so a
 * second patch on top either gets silently overwritten or never fires. `navigate` fires for
 * every kind of navigation regardless of what triggered it — Link click, router.push, back/
 * forward — without touching Next's internals at all.
 *
 * The full-screen overlay is deliberate, not just cosmetic: it sits above everything and
 * blocks clicks, so a slow navigation can't be turned into three by someone re-clicking the
 * tile (or a different one) while the first is still in flight. It also pulls keyboard focus
 * onto itself while visible (the overlay has nothing focusable inside it), so Tab can't reach
 * a control on the page underneath that a click couldn't.
 *
 * Background is a solid brand-dark (`--ink-solid-900`), not a translucent scrim over the
 * page — not a stylistic choice. A semi-transparent background on this element reproducibly
 * fails to paint at all in Chromium whenever `FullScreenLoader`'s logo `<img>` is present
 * anywhere in the tree (confirmed by removing just the image and watching the scrim come
 * back) — an opaque background sidesteps that class of bug entirely rather than chasing it.
 *
 * On a browser without the Navigation API (older Safari), `window.navigation` is undefined
 * and this is a no-op — no loader, nothing broken.
 *
 * Mounted once in the root layout — outside the auth gate, so it also covers the
 * login → dashboard redirect, not just navigation inside the authed app.
 */
export default function NavigationLoader() {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAtRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Move keyboard focus onto the overlay itself as soon as it appears — otherwise whatever
  // was focused underneath (the tile just clicked) stays focused, and Tab can reach further
  // controls on a page a click can no longer touch.
  useEffect(() => {
    if (visible) overlayRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (!nav) return;

    function finish() {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (shownAtRef.current === null) return; // never crossed SHOW_DELAY_MS — nothing to hide
      const elapsed = Date.now() - shownAtRef.current;
      shownAtRef.current = null;
      setTimeout(() => setVisible(false), Math.max(0, MIN_VISIBLE_MS - elapsed));
    }

    function onNavigate(event: NavigateEventLike) {
      if (event.navigationType === "reload" || !event.canIntercept) return;
      if (showTimerRef.current || shownAtRef.current !== null) return; // already tracking one
      showTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        showTimerRef.current = null;
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    nav.addEventListener("navigate", onNavigate);
    nav.addEventListener("navigatesuccess", finish);
    nav.addEventListener("navigateerror", finish);
    return () => {
      nav.removeEventListener("navigate", onNavigate);
      nav.removeEventListener("navigatesuccess", finish);
      nav.removeEventListener("navigateerror", finish);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      role="status"
      aria-live="polite"
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center outline-none"
      style={{ background: "var(--ink-solid-900)" }}
    >
      <FullScreenLoader message="Preparing your workspace…" onDark />
    </div>
  );
}
