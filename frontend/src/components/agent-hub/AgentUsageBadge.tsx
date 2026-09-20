"use client";

import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { AgentUsageRow } from "@/types/api";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";
import type { AgentKey } from "./agents";

const DAYS = 7;

/** "42 calls" / "42 calls · $0.31" — the cost only when the models used were priced (unknown is not zero). */
export function usageLabel(row: AgentUsageRow | undefined): string {
  if (!row) return "No AI calls";
  const calls = `${row.callCount.toLocaleString()} call${row.callCount === 1 ? "" : "s"}`;
  return row.estimatedCostUsd != null ? `${calls} · $${row.estimatedCostUsd.toFixed(2)}` : calls;
}

/** Every agent's usage added together (the universal chat has no single agent). Undefined when there is none. */
export function totalOf(rows: AgentUsageRow[]): AgentUsageRow | undefined {
  if (rows.length === 0) return undefined;
  const priced = rows.filter((r) => r.estimatedCostUsd != null);
  return {
    agent: null,
    callCount: rows.reduce((n, r) => n + r.callCount, 0),
    failureCount: rows.reduce((n, r) => n + r.failureCount, 0),
    promptTokens: rows.reduce((n, r) => n + r.promptTokens, 0),
    completionTokens: rows.reduce((n, r) => n + r.completionTokens, 0),
    estimatedCostUsd: priced.length > 0 ? priced.reduce((n, r) => n + (r.estimatedCostUsd ?? 0), 0) : null,
  };
}

/** Admin-only: this agent's AI usage over the last week. Hidden for everyone else, and if the numbers can't be read. */
export default function AgentUsageBadge({ agent }: { agent: AgentKey | "all" }) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;
  const [rows, setRows] = useState<AgentUsageRow[] | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.getAgentUsage(DAYS).then((r) => !cancelled && setRows(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin || rows === null) return null;
  const row = agent === "all" ? totalOf(rows) : rows.find((r) => r.agent === agent);
  return (
    <Tooltip title={row ? `${row.promptTokens.toLocaleString()} prompt + ${row.completionTokens.toLocaleString()} completion tokens, ${row.failureCount} failed — last ${DAYS} days` : `No AI calls in the last ${DAYS} days`}>
      <Chip size="small" variant="outlined" label={`${DAYS}d · ${usageLabel(row)}`} aria-label={`Usage over the last ${DAYS} days: ${usageLabel(row)}`} />
    </Tooltip>
  );
}
