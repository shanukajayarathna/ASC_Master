"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The busy-flag + re-entry-guard + cleanup pattern every save/create/delete dialog in this
 * app already hand-rolls correctly (ValuationDrawer, every Settings dialog, ExportShareMenu)
 * — one shared primitive for new call sites instead of re-deriving it each time.
 *
 * No built-in error state and no AbortController on purpose: every existing call site keeps
 * its own differently-worded, contextual `error` state, and nothing else in this codebase
 * cancels in-flight requests (existing effects use a local `cancelled` flag instead) — adding
 * cancellation here would be a new, inconsistent primitive for no current need.
 */
export function useAsyncAction<Args extends unknown[], R>(action: (...args: Args) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  // Synchronous guard — `busy` state alone can lag a fast double-click/double-Enter, since
  // React batches the state update rather than applying it before the second call starts.
  const busyRef = useRef(false);

  const run = useCallback(
    async (...args: Args) => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      setBusy(true);
      try {
        return await action(...args);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [action]
  );

  return { busy, run };
}
