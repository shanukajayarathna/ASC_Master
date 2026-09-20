import AnalyticsWorkspace from "@/components/agent-hub/AnalyticsWorkspace";
import { comparePrompt } from "@/components/agent-hub/CompareBuilder";
import { chartSummary, drillPrompt, explainChartPrompt } from "@/components/agent-hub/PinnedBoard";
import { MAX_PINS, answerTitle, pinId } from "@/components/agent-hub/pins";
import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getProviderStatuses: vi.fn(), sendAgentChatMessage: vi.fn() }));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const spec: ChartSpec = {
  type: "bar", title: "Average price by broker", subtitle: "Last 12 sales", unit: "Rs/kg", categoryAxis: "Broker",
  categories: ["ASC", "Forbes", "Bartleet"], series: [{ name: "Avg", values: [1200, 1100, 980] }],
};
const chartReply = `Scope: last 12 sales.\n\`\`\`asc-chart\n${JSON.stringify(spec)}\n\`\`\`\nASC leads.`;

beforeEach(() => {
  window.localStorage.clear();
  api.getProviderStatuses.mockReset().mockResolvedValue([{ key: "local", displayName: "Local", configured: true }]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c1", reply: chartReply, provider: "local" });
  window.history.pushState({}, "", "/assistant/analytics");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

const askAndGetChart = async () => {
  render(<AnalyticsWorkspace />);
  await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Compare brokers over the last 12 sales" }));
  await screen.findByText("Average price by broker");
};

describe("helpers", () => {
  it("builds the compare question from the three choices", () => {
    expect(comparePrompt("broker", "avg", "12")).toBe("Compare brokers by average price (Rs/kg) over the last 12 sales. State the scope you used, then show a table and a chart.");
    expect(comparePrompt("sale", "proceeds", "all")).toContain("sales, as a trend");
    expect(comparePrompt("grade", "qty", "year")).toContain("current year");
  });

  it("describes a chart from its own figures so explaining never depends on chat history", () => {
    const s = chartSummary(spec);
    expect(s).toContain("Average price by broker");
    expect(s).toContain("ASC: Avg=1200");
    expect(explainChartPrompt(spec)).toContain("Use only these figures");
    expect(drillPrompt(spec, "Forbes")).toContain('"Forbes"');
  });

  it("gives the same pin id to the same content, and titles an answer from its first line", () => {
    expect(pinId("chart", "x")).toBe(pinId("chart", "x"));
    expect(pinId("chart", "x")).not.toBe(pinId("answer", "x"));
    expect(answerTitle("## **Top** broker\nmore")).toBe("Top broker");
    expect(answerTitle("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("AnalyticsWorkspace", () => {
  it("uses the shared shell with Analytics current", async () => {
    render(<AnalyticsWorkspace />);
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analytics", current: "page" })).toBeInTheDocument();
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
  });

  it("sends the Compare builder's choices to the Analytics agent", async () => {
    render(<AnalyticsWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Grades" }));
    fireEvent.click(screen.getByRole("button", { name: "Quantity" }));
    fireEvent.click(screen.getByRole("button", { name: "13 years" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));

    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(1));
    const [agent, message, , , catalogueId] = api.sendAgentChatMessage.mock.calls[0];
    expect(agent).toBe("analytics");
    expect(message).toBe(comparePrompt("grade", "qty", "all"));
    expect(catalogueId).toBe("cat-39");
  });

  it("renders the agent's chart with Explain, Pin and drill-down actions", async () => {
    await askAndGetChart();
    expect(screen.getByRole("button", { name: "Explain this chart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
    const drill = screen.getByRole("group", { name: "Drill down" });
    expect(within(drill).getAllByRole("button").map((b) => b.textContent)).toEqual(["ASC", "Forbes", "Bartleet"]);
  });

  it("explains a chart by sending its own figures", async () => {
    await askAndGetChart();
    fireEvent.click(screen.getByRole("button", { name: "Explain this chart" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    const message = api.sendAgentChatMessage.mock.calls[1][1] as string;
    expect(message).toContain("Explain this chart");
    expect(message).toContain("Forbes: Avg=1100");
  });

  it("drills into a category with a follow-up question", async () => {
    await askAndGetChart();
    fireEvent.click(within(screen.getByRole("group", { name: "Drill down" })).getByRole("button", { name: "Forbes" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendAgentChatMessage.mock.calls[1][1]).toBe(drillPrompt(spec, "Forbes"));
  });

  it("pins a chart to the board, keeps it across a reload, and unpins it", async () => {
    await askAndGetChart();
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    const board = screen.getByRole("region", { name: "Pinned insights" });
    await waitFor(() => expect(within(board).getAllByText("Average price by broker").length).toBeGreaterThan(0)); // pin title + the chart's own caption
    expect(within(board).getByText("1/12")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Pinned" }).length).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem("asc.analytics.pins")!)).toHaveLength(1);

    // a fresh mount reads the same board back
    render(<AnalyticsWorkspace />);
    const boards = screen.getAllByRole("region", { name: "Pinned insights" });
    await waitFor(() => expect(within(boards[1]).getAllByText("Average price by broker").length).toBeGreaterThan(0));

    fireEvent.click(within(board).getByRole("button", { name: "Unpin Average price by broker" }));
    await waitFor(() => expect(within(board).getByText(/Pin a chart or answer/)).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("asc.analytics.pins")!)).toHaveLength(0);
  });

  it("stops at the cap instead of silently dropping the oldest pin", async () => {
    const pins = Array.from({ length: MAX_PINS }, (_, i) => ({ id: `answer-${i}`, kind: "answer", title: `Pin ${i}`, text: "t", pinnedAt: "2026-01-01" }));
    window.localStorage.setItem("asc.analytics.pins", JSON.stringify(pins));
    await askAndGetChart();
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByText(/board is full/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("asc.analytics.pins")!)).toHaveLength(MAX_PINS);
  });

  it("ignores a corrupt saved board", async () => {
    window.localStorage.setItem("asc.analytics.pins", "{not json");
    render(<AnalyticsWorkspace />);
    expect(await screen.findByText(/Pin a chart or answer/)).toBeInTheDocument();
  });

  it("offers to pin a plain written answer (no chart)", async () => {
    api.sendAgentChatMessage.mockResolvedValueOnce({ conversationId: "c2", reply: "Forbes had the highest average.", provider: "local" });
    render(<AnalyticsWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Top 10 marks by average price" }));
    await screen.findByText("Forbes had the highest average.");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    const board = screen.getByRole("region", { name: "Pinned insights" });
    expect(await within(board).findByText("Forbes had the highest average.", { selector: "p" })).toBeInTheDocument();
  });
});
