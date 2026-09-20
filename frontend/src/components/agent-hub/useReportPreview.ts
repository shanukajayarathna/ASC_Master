"use client";

import { api } from "@/lib/api";
import type { CustomPreview } from "@/types/api";
import { useEffect, useState } from "react";
import { toRequest, type BuilderState } from "./reportBuilder";

const DEBOUNCE_MS = 400;

/**
 * Runs the archive query for the builder's current choices (after a short pause, so clicking through options
 * doesn't fire a query each time) and returns the computed dataset. Older requests are aborted, so a slow answer
 * for an earlier choice can never overwrite the current one.
 */
export function useReportPreview(state: BuilderState) {
  const [preview, setPreview] = useState<CustomPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(state);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new choice starts a new load
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .previewCustomReport(toRequest(JSON.parse(key) as BuilderState), controller.signal)
        .then((p) => {
          setPreview(p);
          setError(null);
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          setPreview(null);
          setError(e instanceof Error ? e.message : "Couldn't load the preview.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return { preview, loading, error };
}
