"use client";

import { useUiLang } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import "./agent-hub.css";
import { agentName, HUB_AGENTS, type AgentKey } from "./agents";

/** Where a workspace route sends people until its purpose-built workspace exists. */
export const classicChatHref = (agent: AgentKey) => `/assistant/classic?agent=${agent}`;

/**
 * Stand-in for /assistant/<agent> until each purpose-built workspace lands (Phase 2 onward). A tile
 * must never lead to a dead end, so this forwards straight to the working chat with that agent
 * already selected. It uses `replace`, so the browser's Back button returns to the hub instead of
 * bouncing off this route again. Each real workspace replaces this per agent.
 */
export default function AgentWorkspaceStub({ agent }: { agent: AgentKey }) {
  const { t } = useUiLang();
  const router = useRouter();
  const name = agentName(HUB_AGENTS.find((a) => a.key === agent)!, t);

  useEffect(() => {
    router.replace(classicChatHref(agent));
  }, [router, agent]);

  return (
    <div className="agent-hub hub-enter" data-agent={agent} role="status" aria-live="polite">
      <p className="m-0 py-16 text-center text-[14px]" style={{ color: "var(--text-muted)" }}>
        {t.hubOpening(name)}
      </p>
    </div>
  );
}
