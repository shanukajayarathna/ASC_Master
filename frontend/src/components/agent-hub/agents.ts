/**
 * The four agents the hub knows about. Keys match the backend's `IAgent.Key` values (Modules/Agents) —
 * they are what `POST /api/v1/assistant/chat` takes as `agent`, so they must not be renamed here without
 * the backend.
 *
 * On the hub, General is not a tile: it IS the ask box (people start by asking, not by choosing), and the
 * three specialists are offered below it as a compact row of links, one per job. Numbering ("Agent 01") is
 * presentation only.
 */
import type { UiStrings } from "@/lib/i18n";

export type AgentKey = "general" | "auction" | "analytics" | "reports";

export interface HubAgent {
  key: AgentKey;
  /** 1-4, shown as "Agent 0N". */
  number: 1 | 2 | 3 | 4;
  nameKey: "agentGeneral" | "agentAuction" | "agentAnalytics" | "agentReports";
  purposeKey: "agentGeneralPurpose" | "agentAuctionPurpose" | "agentAnalyticsPurpose" | "agentReportsPurpose";
  capsKey: "agentGeneralCaps" | "agentAuctionCaps" | "agentAnalyticsCaps" | "agentReportsCaps";
}

export const HUB_AGENTS: readonly HubAgent[] = [
  { key: "general", number: 1, nameKey: "agentGeneral", purposeKey: "agentGeneralPurpose", capsKey: "agentGeneralCaps" },
  { key: "auction", number: 2, nameKey: "agentAuction", purposeKey: "agentAuctionPurpose", capsKey: "agentAuctionCaps" },
  { key: "analytics", number: 3, nameKey: "agentAnalytics", purposeKey: "agentAnalyticsPurpose", capsKey: "agentAnalyticsCaps" },
  { key: "reports", number: 4, nameKey: "agentReports", purposeKey: "agentReportsPurpose", capsKey: "agentReportsCaps" },
] as const;

const KEYS = new Set<string>(HUB_AGENTS.map((a) => a.key));

export const isAgentKey = (value: string): value is AgentKey => KEYS.has(value);

export const agentHref = (key: AgentKey) => `/assistant/${key}`;

export const agentName = (agent: HubAgent, t: UiStrings) => t[agent.nameKey];

/** The specialists — every agent except General, which is the ask box. */
export const SPECIALISTS: readonly HubAgent[] = HUB_AGENTS.filter((a) => a.key !== "general");

/**
 * Where a question typed on the hub goes: the General workspace, with the question sent straight away
 * (`send=1`) rather than only prefilled, so asking takes one step. The workspace performs the send.
 */
export const askHref = (question: string) => `/assistant/general?send=1&q=${encodeURIComponent(question)}`;
