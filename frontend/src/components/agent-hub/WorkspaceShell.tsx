"use client";

import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { useUiLang } from "@/lib/i18n";
import Chip from "@mui/material/Chip";
import Link from "next/link";
import type { ReactNode } from "react";
import { agentHref, agentName, HUB_AGENTS, type AgentKey } from "./agents";
import type { OrbState } from "./VoiceOrb";
import "./workspace.css";

const STATE_LABEL: Record<OrbState, string> = { idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

interface WorkspaceShellProps {
  agent: AgentKey;
  /** Drives the coloured status orb beside the agent's name. */
  status: OrbState;
  /** Extra header controls (provider picker, new chat, …). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * The frame every agent workspace shares: the system's PageHeader with an "All agents" back link, the agent's
 * name with a coloured status orb, the sale in context, and an agent switcher. Each workspace sets its own
 * accent through `data-agent` (workspace.css) and supplies the body.
 */
export default function WorkspaceShell({ agent, status, actions, children }: WorkspaceShellProps) {
  const { t } = useUiLang();
  const { activeCatalogue } = useCatalogue();
  const current = HUB_AGENTS.find((a) => a.key === agent)!;
  const name = agentName(current, t);

  return (
    <div className="chat-vh flex flex-col workspace" data-agent={agent}>
      <PageHeader
        title={name}
        backTo={{ href: "/assistant", label: t.hubAllAgents }}
        subtitle={
          <span className="ws-status" role="status">
            <span className="ws-status-orb" data-state={status} aria-hidden="true" />
            {STATE_LABEL[status]}
          </span>
        }
        actions={
          <>
            <Chip size="small" variant="outlined" label={activeCatalogue ? activeCatalogue.sourceName : t.hubNoSale} />
            {actions}
          </>
        }
      />

      <nav className="ws-switcher" aria-label="Switch agent">
        {HUB_AGENTS.map((a) => {
          const label = agentName(a, t);
          const active = a.key === agent;
          return (
            <Link key={a.key} href={agentHref(a.key)} className="ws-pill" data-agent={a.key} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
