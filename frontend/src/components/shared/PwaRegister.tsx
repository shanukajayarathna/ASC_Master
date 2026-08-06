"use client";

import { useEffect } from "react";

/** Registers public/sw.js once the app has mounted — mounted in the root layout so it runs on
 *  every route, not just the authenticated app shell (installability doesn't care which page
 *  loaded first). Renders nothing; a failed registration (unsupported browser, blocked by an
 *  extension) is silently ignored since the app works fully without it either way.
 *
 *  Production only. sw.js cache-first-serves /_next/static/* under a cache key that never
 *  changes — exactly right for production's content-hashed, immutable build output, but
 *  actively wrong in dev: Turbopack's dev chunks are rebuilt in place on every edit, so a
 *  dev-mode registration serves a stale chunk from a previous session no matter how many
 *  times the dev server restarts (this bit us once already — see the "module factory is not
 *  available" class of error). Also unregisters any such stale dev-mode registration left
 *  over from before this guard existed, so it self-heals without a manual DevTools step. */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
    }
  }, []);

  return null;
}
