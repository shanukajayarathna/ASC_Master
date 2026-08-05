"use client";

import { useEffect } from "react";

/** Registers public/sw.js once the app has mounted — mounted in the root layout so it runs on
 *  every route, not just the authenticated app shell (installability doesn't care which page
 *  loaded first). Renders nothing; a failed registration (unsupported browser, blocked by an
 *  extension) is silently ignored since the app works fully without it either way. */
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
