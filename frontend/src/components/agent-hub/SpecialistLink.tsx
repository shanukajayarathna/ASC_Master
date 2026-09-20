import type { UiStrings } from "@/lib/i18n";
import Link from "next/link";
import type { ReactNode } from "react";
import { agentHref, agentName, type AgentKey, type HubAgent } from "./agents";

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Small line icons, one per job. Decorative — the name and description carry the meaning. */
const ICONS: Record<Exclude<AgentKey, "general">, ReactNode> = {
  auction: icon(<><path d="M14 4l6 6" /><path d="M10.5 7.5l6 6" /><path d="M12 6l-7 7 3 3 7-7" /><path d="M4 20h9" /></>),
  analytics: icon(<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 15l4-4 3 3 5-6" /></>),
  reports: icon(<><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 13h5" /><path d="M10 17h5" /></>),
};

/**
 * One specialist, as a compact link: icon, name, and the job it does. A plain link to the agent's
 * workspace — keyboard, middle-click and screen readers work with no scripting.
 */
export default function SpecialistLink({ agent, t }: { agent: HubAgent; t: UiStrings }) {
  const name = agentName(agent, t);
  const key = agent.key as Exclude<AgentKey, "general">;
  return (
    <Link href={agentHref(agent.key)} className="hub-spec" data-agent={agent.key} aria-label={t.hubOpenAgent(name)}>
      <span className="hub-spec-icon" aria-hidden="true">{ICONS[key]}</span>
      <span className="hub-spec-text">
        <span className="hub-spec-name">{name}</span>
        <span className="hub-spec-desc">{t[agent.purposeKey]}</span>
      </span>
    </Link>
  );
}
