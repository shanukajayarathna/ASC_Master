import { redirect } from "next/navigation";

/**
 * The per-agent workspace URLs (/assistant/general, /auction, /analytics, /reports) belonged to an earlier design with
 * a separate page per agent. There is one assistant now, so an old bookmark or link lands there instead of a 404.
 * (/assistant/classic is a real route and takes precedence over this dynamic segment.)
 */
export default function RetiredAgentWorkspace() {
  redirect("/assistant");
}
