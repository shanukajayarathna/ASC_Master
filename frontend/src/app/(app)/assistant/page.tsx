import UniversalAssistant from "@/components/agent-hub/UniversalAssistant";

/**
 * The AI Assistant: one conversation, with the right specialist chosen behind the scenes. The original chat lives
 * on at /assistant/classic. The dashboard's Ask ASC box arrives with `?q=…` (prefilled, never sent) and hub-style
 * links may carry `?send=1&q=…` (sent once) — the conversation handles both itself (see useAgentChat).
 */
export default function AssistantPage() {
  return <UniversalAssistant />;
}
