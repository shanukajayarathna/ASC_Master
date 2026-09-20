import ReportsWorkspace from "@/components/agent-hub/ReportsWorkspace";
import AnalyticsWorkspace from "@/components/agent-hub/AnalyticsWorkspace";
import AuctionWorkspace from "@/components/agent-hub/AuctionWorkspace";
import GeneralWorkspace from "@/components/agent-hub/GeneralWorkspace";
import AgentWorkspaceStub from "@/components/agent-hub/AgentWorkspaceStub";
import { HUB_AGENTS, isAgentKey } from "@/components/agent-hub/agents";
import { notFound } from "next/navigation";

// Only the four known agents exist as workspaces; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return HUB_AGENTS.map((a) => ({ agent: a.key }));
}

export default async function AgentWorkspacePage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  if (!isAgentKey(agent)) notFound();
  // Every agent has its own workspace now; the classic-chat stub below is only a safety net for a future agent key.
  if (agent === "general") return <GeneralWorkspace />;
  if (agent === "auction") return <AuctionWorkspace />;
  if (agent === "analytics") return <AnalyticsWorkspace />;
  if (agent === "reports") return <ReportsWorkspace />;
  return <AgentWorkspaceStub agent={agent} />;
}
