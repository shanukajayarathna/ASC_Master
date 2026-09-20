import { usageLabel } from "@/components/agent-hub/AgentUsageBadge";
import AuctionWorkspace from "@/components/agent-hub/AuctionWorkspace";
import GeneralWorkspace from "@/components/agent-hub/GeneralWorkspace";
import type { AgentUsageRow } from "@/types/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  mslAnalyticsSales: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  getLots: vi.fn(),
  getBylawsClause: vi.fn(),
  getAgentUsage: vi.fn(),
}));
const auth = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const row = (over: Partial<AgentUsageRow> = {}): AgentUsageRow => ({ agent: "general", callCount: 42, failureCount: 1, promptTokens: 1000, completionTokens: 500, estimatedCostUsd: 0.314, ...over });

beforeEach(() => {
  auth.roles = [];
  api.getProviderStatuses.mockReset().mockResolvedValue([]);
  api.mslAnalyticsSales.mockReset().mockResolvedValue([]);
  api.getAgentUsage.mockReset().mockResolvedValue([row()]);
  api.getBylawsClause.mockReset().mockResolvedValue({ title: "Default penalties", text: "1% per day for days 1-3.", lastVerified: "2026-01-01", caveat: "The original PDF is authoritative." });
  api.sendAgentChatMessage.mockReset().mockResolvedValue({
    conversationId: "c", reply: "The penalty is 1% a day.", provider: "local",
    sources: [{ kind: "bylaws", label: "CTTA By-Laws", detail: "Default penalties" }, { kind: "catalogue", label: "Sale catalogue data" }],
  });
  window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

const ask = async (text = "What is the default penalty?") => {
  render(<GeneralWorkspace />);
  await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("The penalty is 1% a day.");
};

describe("source chips", () => {
  it("shows where an answer's figures came from, under the answer", async () => {
    await ask();
    const list = screen.getByRole("list", { name: "Sources" });
    expect(within(list).getByText("Source · Sale catalogue data")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Open by-law section Default penalties" })).toHaveTextContent("Source · CTTA By-Laws · Default penalties");
  });

  it("opens the cited by-law clause, with its caveat, and closes again", async () => {
    await ask();
    fireEvent.click(screen.getByRole("button", { name: "Open by-law section Default penalties" }));

    const dialog = await screen.findByRole("dialog", { name: /CTTA By-Laws · Default penalties/ });
    expect(await within(dialog).findByText("1% per day for days 1-3.")).toBeInTheDocument();
    expect(within(dialog).getByText(/The original PDF is authoritative\. Last verified 2026-01-01/)).toBeInTheDocument();
    expect(api.getBylawsClause).toHaveBeenCalledWith("Default penalties");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says so when the clause can't be loaded", async () => {
    api.getBylawsClause.mockRejectedValue(new Error("No by-laws section matches 'x'."));
    await ask();
    fireEvent.click(screen.getByRole("button", { name: "Open by-law section Default penalties" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No by-laws section matches");
  });

  it("shows no source row when no tool was used", async () => {
    api.sendAgentChatMessage.mockResolvedValue({ conversationId: "c", reply: "The penalty is 1% a day.", provider: "local" });
    await ask();
    expect(screen.queryByRole("list", { name: "Sources" })).not.toBeInTheDocument();
  });
});

describe("admin usage badge", () => {
  it("formats calls, and cost only when the models were priced", () => {
    expect(usageLabel(row())).toBe("42 calls · $0.31");
    expect(usageLabel(row({ callCount: 1, estimatedCostUsd: null }))).toBe("1 call");
    expect(usageLabel(undefined)).toBe("No AI calls");
  });

  it("shows an admin their agent's last-week usage, matched to the agent", async () => {
    auth.roles = ["Admin"];
    api.getAgentUsage.mockResolvedValue([row({ agent: "auction", callCount: 7, estimatedCostUsd: null }), row()]);
    render(<GeneralWorkspace />);
    expect(await screen.findByLabelText("Usage over the last 7 days: 42 calls · $0.31")).toBeInTheDocument();
    expect(api.getAgentUsage).toHaveBeenCalledWith(7);
  });

  it("says there were no calls for an agent with none", async () => {
    auth.roles = ["Admin"];
    api.getAgentUsage.mockResolvedValue([row({ agent: "reports" })]);
    render(<AuctionWorkspace />);
    expect(await screen.findByLabelText("Usage over the last 7 days: No AI calls")).toBeInTheDocument();
  });

  it("is invisible to everyone else and never asks the admin endpoint", async () => {
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Usage over the last/)).not.toBeInTheDocument();
    expect(api.getAgentUsage).not.toHaveBeenCalled();
  });

  it("stays hidden if the numbers can't be read", async () => {
    auth.roles = ["Admin"];
    api.getAgentUsage.mockRejectedValue(new Error("403"));
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getAgentUsage).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Usage over the last/)).not.toBeInTheDocument();
  });
});
