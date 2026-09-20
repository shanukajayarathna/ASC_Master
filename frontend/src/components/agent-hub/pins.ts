"use client";

import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { api } from "@/lib/api";
import type { AnalyticsPinDto } from "@/types/api";
import { useCallback, useEffect, useState } from "react";

/** Pins used to live only in this browser; they are moved to the server (once) the first time the board loads. */
const LEGACY_KEY = "asc.analytics.pins";
export const MAX_PINS = 12;

export interface Pin {
  /** The server's id — what unpinning uses. */
  id: string;
  /** Stable id of the content, so pinning the same chart twice does nothing. */
  key: string;
  /** A chart the agent built, or a written answer. */
  kind: "chart" | "answer";
  title: string;
  chart?: ChartSpec;
  /** Answer text, with charts replaced by a short marker. */
  text?: string;
  pinnedAt: string;
}

export type NewPin = Omit<Pin, "id" | "pinnedAt">;

/** Stable id from the content, so pinning the same chart twice does nothing. */
export function pinId(kind: Pin["kind"], content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0;
  return `${kind}-${(h >>> 0).toString(36)}`;
}

/** First non-empty line of an answer, trimmed for a board card title. */
export function answerTitle(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/[#*_`>|]/g, "").trim()).find((l) => l.length > 0) ?? "Pinned answer";
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function fromDto(d: AnalyticsPinDto): Pin | null {
  try {
    return {
      id: d.id, key: d.key, kind: d.kind, title: d.title, pinnedAt: d.pinnedAt,
      chart: d.chartJson ? (JSON.parse(d.chartJson) as ChartSpec) : undefined,
      text: d.text ?? undefined,
    };
  } catch {
    return null; // a pin whose chart can't be read is skipped rather than breaking the board
  }
}

function readLegacy(): { id: string; kind: Pin["kind"]; title: string; chart?: ChartSpec; text?: string }[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === "string" && (p.kind === "chart" || p.kind === "answer")) : [];
  } catch {
    return [];
  }
}

/**
 * The Analytics workspace's pinned-insights board, kept on the server per user so it follows you between devices.
 * Capped at 12; pinning the same content twice is a no-op, and a full board says so instead of dropping the oldest.
 * Pins saved by an earlier version in this browser are uploaded once and then cleared.
 */
export function usePins() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = await api.listPins();
        const legacy = readLegacy();
        if (legacy.length > 0) {
          const have = new Set(list.map((p) => p.key));
          for (const old of [...legacy].reverse()) {
            if (have.has(old.id) || (old.kind === "chart" && !old.chart)) continue;
            const res = await api.createPin({ key: old.id, kind: old.kind, title: old.title, chartJson: old.chart ? JSON.stringify(old.chart) : null, text: old.text ?? null }).catch(() => null);
            if (res?.status === "full") break;
          }
          window.localStorage.removeItem(LEGACY_KEY);
          list = await api.listPins();
        }
        if (!cancelled) setPins(list.map(fromDto).filter((p): p is Pin => p !== null));
      } catch {
        /* the board simply stays empty if the server can't be reached */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pin = useCallback(async (p: NewPin): Promise<"added" | "exists" | "full" | "error"> => {
    try {
      const res = await api.createPin({ key: p.key, kind: p.kind, title: p.title, chartJson: p.chart ? JSON.stringify(p.chart) : null, text: p.text ?? null });
      const created = res.pin ? fromDto(res.pin) : null;
      if (res.status === "added" && created) setPins((cur) => [created, ...cur]);
      return res.status;
    } catch {
      return "error";
    }
  }, []);

  const unpin = useCallback(async (id: string) => {
    setPins((cur) => cur.filter((p) => p.id !== id)); // optimistic; restored below if the server refuses
    try {
      await api.deletePin(id);
    } catch {
      try {
        setPins((await api.listPins()).map(fromDto).filter((p): p is Pin => p !== null));
      } catch {
        /* leave as is */
      }
    }
  }, []);

  const isPinned = useCallback((key: string) => pins.some((p) => p.key === key), [pins]);

  return { pins, loaded, pin, unpin, isPinned };
}
