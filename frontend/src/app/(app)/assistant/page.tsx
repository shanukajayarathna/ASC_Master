import AgentHub from "@/components/agent-hub/AgentHub";
import { redirect } from "next/navigation";

/**
 * The AI Assistant hub. The original single chat now lives at /assistant/classic, unchanged.
 *
 * The dashboard's Ask ASC box arrives here with `?q=…`. That is redirected on the server, before any
 * hub markup is rendered, so a prefilled question goes straight to the chat with no flash of the hub.
 * (Reading `searchParams` makes this route dynamic; it is a small page, so that costs nothing.)
 * Until the General workspace takes prefills over, the chat is the place that handles them.
 */
export default async function AssistantHubPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const text = Array.isArray(q) ? q[0] : q;
  if (text) redirect(`/assistant/classic?q=${encodeURIComponent(text)}`);
  return <AgentHub />;
}
