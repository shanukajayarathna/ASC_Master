"use client";

import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useThemeMode } from "@/context/ThemeModeContext";
import { getInFlightRequestCount, subscribeInFlightRequests } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

// Only shown if a navigation is still in flight after this long — most transitions (a
// prefetched tile, an already-visited route) resolve well under this, so the loader would
// otherwise just flash uselessly.
const SHOW_DELAY_MS = 150;
// Once shown, stays up at least this long — without this a navigation that finishes just
// after the delay above would pop in and immediately vanish, reading as a glitch.
const MIN_VISIBLE_MS = 350;
// `navigatesuccess` only means the route committed — the destination page's own useEffect
// fetches are still ahead at that point (every page is a client component that loads its
// data after mount; see docs/28). So the overlay stays up until the API has been quiet for
// this long. The window has to bridge two real zero-in-flight gaps: commit → paint → the
// page's effects firing their first fetch (can take a few hundred ms on a weak tablet),
// and one response triggering the next fetch of a waterfall (the dashboard's catalogues →
// per-sale stats chain).
const SETTLE_QUIET_MS = 400;
// Safety valve: a hung request must never leave the app bricked behind an unclosable
// overlay — past this the page underneath shows its own skeleton/error state instead.
const SETTLE_MAX_MS = 15_000;

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
 * The overlay covers two phases, because `navigatesuccess` alone ends too early: it fires
 * as soon as the destination's component tree commits, while the page's real content is
 * still being fetched by its own useEffects behind skeletons (docs/28 records confirming
 * this empirically). So after the route commits, the overlay stays up until `lib/api.ts`'s
 * in-flight request counter has sat at zero for SETTLE_QUIET_MS — i.e. until the new page
 * has genuinely finished loading, waterfalls included — capped at SETTLE_MAX_MS so a hung
 * request can't brick navigation. A follow-up navigation during the settle (login's
 * redirect, valuation stripping its consumed ?focus=1 param) just restarts the wait for
 * its own navigatesuccess; the overlay holds through the whole chain.
 *
 * The full-screen overlay is deliberate, not just cosmetic: it sits above everything and
 * blocks clicks, so a slow navigation can't be turned into three by someone re-clicking the
 * tile (or a different one) while the first is still in flight. It also pulls keyboard focus
 * onto itself while visible (the overlay has nothing focusable inside it), so Tab can't reach
 * a control on the page underneath that a click couldn't.
 *
 * Background is a frosted veil — a translucent theme-aware wash (`--overlay-veil`) plus a
 * backdrop blur — so the page stays faintly visible underneath while everything on it is
 * unreadable and unclickable. History note: an earlier translucent version reproducibly
 * failed to paint in Chromium whenever `FullScreenLoader`'s logo `<img>` was in the tree,
 * which is why this overlay spent a while opaque (`--ink-solid-900`). That failure had the
 * translucent background on this outer element itself; the veil now lives on a dedicated
 * child layer whose `backdrop-filter` forces its own compositing layer, and the frosted
 * rendering was re-verified painting correctly in headless Chromium after the change. If a
 * blank (fully transparent) scrim ever reappears, suspect that bug first and check whether
 * removing the logo image brings the veil back.
 *
 * Because the page shows through now, the loader colors follow the active theme (ambient
 * tokens on the light veil, the on-dark fixed palette on the dark one) instead of always
 * assuming a dark ground.
 *
 * On a browser without the Navigation API (older Safari), `window.navigation` is undefined
 * and this is a no-op — no loader, nothing broken.
 *
 * Mounted once in the root layout — outside the auth gate, so it also covers the
 * login → dashboard redirect, not just navigation inside the authed app.
 */
export default function NavigationLoader() {
  const [visible, setVisible] = useState(false);
  const { mode } = useThemeMode();
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // True from a tracked `navigate` until the overlay is released — spans both phases.
  const trackingRef = useRef(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAtRef = useRef<number | null>(null);
  // The MIN_VISIBLE_MS tail — kept in a ref so a navigation arriving inside it can cancel
  // the hide and keep the overlay up instead of hiding and re-showing 150ms later.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Move keyboard focus onto the overlay itself as soon as it appears — otherwise whatever
  // was focused underneath (the tile just clicked) stays focused, and Tab can reach further
  // controls on a page a click can no longer touch.
  useEffect(() => {
    if (visible) overlayRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (!nav) return;

    function cancelSettle() {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current);
        quietTimerRef.current = null;
      }
      if (capTimerRef.current) {
        clearTimeout(capTimerRef.current);
        capTimerRef.current = null;
      }
    }

    function hide() {
      cancelSettle();
      trackingRef.current = false;
      if (showTimerRef.current) {
        // Route + data both finished inside SHOW_DELAY_MS — never shown, nothing to hide.
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
        return;
      }
      if (shownAtRef.current === null) return;
      const elapsed = Date.now() - shownAtRef.current;
      shownAtRef.current = null;
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setVisible(false);
      }, Math.max(0, MIN_VISIBLE_MS - elapsed));
    }

    // Phase 2: the route committed; hold until the API has been idle for SETTLE_QUIET_MS.
    function beginSettle() {
      cancelSettle();
      capTimerRef.current = setTimeout(hide, SETTLE_MAX_MS);
      const check = () => {
        if (getInFlightRequestCount() === 0) {
          if (!quietTimerRef.current) quietTimerRef.current = setTimeout(hide, SETTLE_QUIET_MS);
        } else if (quietTimerRef.current) {
          clearTimeout(quietTimerRef.current);
          quietTimerRef.current = null;
        }
      };
      unsubscribeRef.current = subscribeInFlightRequests(check);
      check();
    }

    function onNavigate(event: NavigateEventLike) {
      if (event.navigationType === "reload" || !event.canIntercept) return;
      // A follow-up navigation while a previous one is settling — abandon that settle and
      // wait for the new navigation's own navigatesuccess instead.
      cancelSettle();
      if (trackingRef.current) return; // already tracking one
      trackingRef.current = true;
      if (hideTimerRef.current) {
        // Still visible from the previous navigation's minimum-visible tail — keep it up.
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
        shownAtRef.current = Date.now();
        return;
      }
      showTimerRef.current = setTimeout(() => {
        shownAtRef.current = Date.now();
        showTimerRef.current = null;
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    function onSuccess() {
      if (!trackingRef.current) return;
      beginSettle();
    }

    function onError() {
      // Failed/aborted navigation — nothing new is loading, release the overlay now.
      hide();
    }

    nav.addEventListener("navigate", onNavigate);
    nav.addEventListener("navigatesuccess", onSuccess);
    nav.addEventListener("navigateerror", onError);
    return () => {
      nav.removeEventListener("navigate", onNavigate);
      nav.removeEventListener("navigatesuccess", onSuccess);
      nav.removeEventListener("navigateerror", onError);
      cancelSettle();
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
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
    >
      {/* The frosted veil sits on its own layer, NOT as a background on the element that
          contains the logo <img> — see the Chromium paint-bug note in the doc comment. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "var(--overlay-veil)",
          backdropFilter: "blur(14px) saturate(1.1)",
          WebkitBackdropFilter: "blur(14px) saturate(1.1)",
        }}
      />
      {/* Positioned so it paints above the veil (an absolute sibling with auto z-index
          would otherwise paint over in-flow content). */}
      <div className="relative">
        <FullScreenLoader message="Preparing your workspace…" onDark={mode === "dark"} />
      </div>
    </div>
  );
}
