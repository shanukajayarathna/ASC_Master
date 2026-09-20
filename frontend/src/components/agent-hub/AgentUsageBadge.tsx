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

/** Admin-only: this agent's AI usage over the last week. Hidden for everyone else, and if the numbers can't be read. */
export default function AgentUsageBadge({ agent }: { agent: AgentKey }) {
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
  const row = rows.find((r) => r.agent === agent);
  return (
    <Tooltip title={row ? `${row.promptTokens.toLocaleString()} prompt + ${row.completionTokens.toLocaleString()} completion tokens, ${row.failureCount} failed — last ${DAYS} days` : `No AI calls in the last ${DAYS} days`}>
      <Chip size="small" variant="outlined" label={`${DAYS}d · ${usageLabel(row)}`} aria-label={`Usage over the last ${DAYS} days: ${usageLabel(row)}`} />
    </Tooltip>
  );
}
