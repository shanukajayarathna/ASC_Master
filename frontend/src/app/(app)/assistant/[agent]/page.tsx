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
  // General has its own workspace; the specialists open the classic chat until theirs are built.
  if (agent === "general") return <GeneralWorkspace />;
  return <AgentWorkspaceStub agent={agent} />;
}
