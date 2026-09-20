/**
 * The four specialists behind the universal assistant. Keys match the backend's `IAgent.Key` values
 * (Modules/Agents) — they are what `POST /api/v1/assistant/chat` takes as `agent` (or "auto" to let the router
 * choose), so they must not be renamed here without the backend.
 */
export type AgentKey = "general" | "auction" | "analytics" | "reports";

export const AGENT_KEYS: readonly AgentKey[] = ["general", "auction", "analytics", "reports"];

export const AGENT_LABEL: Record<AgentKey, string> = { general: "General", auction: "Auction", analytics: "Analytics", reports: "Reports" };

export const isAgentKey = (value: string | null | undefined): value is AgentKey => !!value && (AGENT_KEYS as readonly string[]).includes(value);
