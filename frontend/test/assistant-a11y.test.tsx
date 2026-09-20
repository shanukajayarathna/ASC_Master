// Automated accessibility check (axe-core, already present in node_modules via another dependency) over the hub
// and every workspace. jsdom cannot compute colours or layout, so colour-contrast and the layout-dependent rules are
// covered by the real-browser checks instead; everything structural (names, roles, labels, ids, landmarks) runs here.
import AgentHub from "@/components/agent-hub/AgentHub";
import AnalyticsWorkspace from "@/components/agent-hub/AnalyticsWorkspace";
import AuctionWorkspace from "@/components/agent-hub/AuctionWorkspace";
import GeneralWorkspace from "@/components/agent-hub/GeneralWorkspace";
import ReportsWorkspace from "@/components/agent-hub/ReportsWorkspace";
import type { CustomPreview } from "@/types/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  listPins: vi.fn(() => Promise.resolve([])),
  listReportSpecs: vi.fn(() => Promise.resolve([])),
  mslAnalyticsSales: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  previewCustomReport: vi.fn(),
  getLots: vi.fn(),
  saveCustomReport: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { roles: [] } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const preview: CustomPreview = {
  title: "Average price by broker", scope: "all brokers · the last 12 sales", metric: "m", unit: "Rs/kg", additive: false, split: false,
  categoryAxis: "Broker", categories: ["ASC", "FW"], series: [{ name: "Average price", values: [1200, 1100] }], markdownTable: "| a |\n|---|\n| 1 |",
};

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    resultTypes: ["violations"],
  });
  return results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

beforeEach(() => {
  api.getProviderStatuses.mockReset().mockResolvedValue([{ key: "local", displayName: "Local", configured: true }]);
  api.mslAnalyticsSales.mockReset().mockResolvedValue([{ year: 2026, saleNo: 32 }]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c", reply: "Answer", provider: "local" });
  api.previewCustomReport.mockReset().mockResolvedValue(preview);
  api.getLots.mockReset().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 8 });
  window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("assistant accessibility (structural)", () => {
  it("the hub has no violations", async () => {
    const { container } = render(<AgentHub />);
    expect(await violations(container)).toEqual([]);
  });

  it("the General workspace has no violations, including after an answer", async () => {
    const { container } = render(<GeneralWorkspace />);
    await waitFor(() => expect(api.mslAnalyticsSales).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Compare brokers over the last 12 sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Answer");
    expect(await violations(container)).toEqual([]);
  });

  it("the Auction workspace has no violations with a lot open", async () => {
    api.getLots.mockResolvedValue({
      rows: [{ id: "l1", rowKey: "k", lotNumber: "1", broker: "FW", grade: "BOPF", garden: "Ken", netWeight: 1, rawData: {}, valuation: null }],
      total: 1, page: 1, pageSize: 8,
    });
    const { container } = render(<AuctionWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "ken" } });
    fireEvent.click(await screen.findByRole("button", { name: /Ken/ }));
    expect(await violations(container)).toEqual([]);
  });

  it("the Analytics workspace has no violations with a pinned chart", async () => {
    const spec = { type: "bar", title: "T", unit: "kg", categories: ["A", "B"], series: [{ name: "s", values: [1, 2] }] };
    api.sendAgentChatMessage.mockResolvedValue({ conversationId: "c", reply: `x\n\`\`\`asc-chart\n${JSON.stringify(spec)}\n\`\`\`\ny`, provider: "local" });
    const { container } = render(<AnalyticsWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Top 10 marks by average price" }));
    await screen.findByRole("button", { name: "Explain this chart" });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await violations(container)).toEqual([]);
  });

  it("the Reports workspace has no violations, including the deck and voice cards", async () => {
    const { container } = render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price by broker" });
    fireEvent.click(screen.getByRole("button", { name: "Add this report to the deck" }));
    expect(await violations(container)).toEqual([]);
  });
});
