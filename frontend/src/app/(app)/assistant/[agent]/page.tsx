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
  return <AgentWorkspaceStub agent={agent} />;
}
