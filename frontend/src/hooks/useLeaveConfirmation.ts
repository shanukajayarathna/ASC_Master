"use client";

import { useEffect } from "react";

/** Minimal shape of the (Chromium-only, as of this writing) Navigation API this hook uses —
 *  not yet in TypeScript's own DOM lib, so declared by hand rather than reaching for `any`
 *  at every call site. */
interface NavigateEvent extends Event {
  readonly canIntercept: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly destination: { readonly url: string };
}
interface NavigationApi extends EventTarget {
  navigate(url: string): unknown;
}

/**
 * Warns before the user leaves the page while `isBusy` is true — a report mid-generation, an
 * upload in flight, an export running — so a closed tab, a refresh, or a click to another
 * page doesn't silently throw away work that's already running and can't be resumed.
 *
 * Two separate leave paths, handled two different ways because the platform gives no single
 * hook for both:
 *  - Tab close / refresh / typing a new URL / an external link: the native `beforeunload`
 *    dialog. Every modern browser hard-codes its own generic text here (no site can supply
 *    its own message any more — an old, since-closed cross-site phishing hole) — the
 *    `message` argument does NOT reach this dialog. Universally supported.
 *  - An in-app navigation (a Next.js <Link>/router.push, or the browser back/forward
 *    buttons): caught via the browser's Navigation API `navigate` event, which — unlike
 *    beforeunload — fires BEFORE the URL/DOM actually changes and lets this cancel it, so a
 *    real `window.confirm(message)` with the actual message can gate it. Chromium-only as of
 *    this writing (not yet in Safari/Firefox); on those browsers in-app navigation away from
 *    a busy page is simply not caught — only the beforeunload guard above still applies
 *    there, same as any other unsupported-API fallback in this codebase.
 */
export function useLeaveConfirmation(
  isBusy: boolean,
  message = "This is still running. Leaving now will cancel it — continue?"
) {
  useEffect(() => {
    if (!isBusy) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const nav = (window as unknown as { navigation?: NavigationApi }).navigation;
    const handleNavigate = (e: Event) => {
      const navEvent = e as NavigateEvent;
      // Only same-document SPA navigations can be intercepted at all (canIntercept is false
      // for a cross-origin destination, for example); a hash-only change or a download link
      // isn't a "leaving the page" navigation and shouldn't prompt.
      if (!navEvent.canIntercept || navEvent.hashChange || navEvent.downloadRequest !== null) return;
      if (!window.confirm(message)) navEvent.preventDefault();
    };
    nav?.addEventListener("navigate", handleNavigate);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      nav?.removeEventListener("navigate", handleNavigate);
    };
  }, [isBusy, message]);
}
