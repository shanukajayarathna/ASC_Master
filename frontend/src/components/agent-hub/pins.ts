"use client";

import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { useCallback, useEffect, useState } from "react";

const KEY = "asc.analytics.pins";
export const MAX_PINS = 12;

export interface Pin {
  id: string;
  /** A chart the agent built, or a written answer. */
  kind: "chart" | "answer";
  title: string;
  chart?: ChartSpec;
  /** Answer text, with charts replaced by a short marker. */
  text?: string;
  pinnedAt: string;
}

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

function read(): Pin[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Pin[]).filter((p) => p && typeof p.id === "string" && (p.kind === "chart" || p.kind === "answer")) : [];
  } catch {
    return [];
  }
}

/**
 * The Analytics workspace's pinned-insights board. Pins live in this browser's localStorage (a per-viewer
 * convenience — they don't follow you to another device). Capped, newest first; pinning the same content
 * twice is a no-op, and a full board says so instead of silently dropping the oldest.
 */
export function usePins() {
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
    setPins(read());
  }, []);

  const write = useCallback((next: Pin[]) => {
    setPins(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage blocked or full — the pin still shows for this session */
    }
  }, []);

  const pin = useCallback(
    (p: Omit<Pin, "pinnedAt">): "added" | "exists" | "full" => {
      const current = read();
      if (current.some((x) => x.id === p.id)) return "exists";
      if (current.length >= MAX_PINS) return "full";
      write([{ ...p, pinnedAt: new Date().toISOString() }, ...current]);
      return "added";
    },
    [write],
  );

  const unpin = useCallback((id: string) => write(read().filter((p) => p.id !== id)), [write]);
  const isPinned = useCallback((id: string) => pins.some((p) => p.id === id), [pins]);

  return { pins, pin, unpin, isPinned };
}
