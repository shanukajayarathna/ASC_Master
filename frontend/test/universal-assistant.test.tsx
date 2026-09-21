import UniversalAssistant from "@/components/agent-hub/UniversalAssistant";
import type { ChartSpec } from "@/components/assistant/ChartBlock";
import type { CustomPreview, Lot } from "@/types/api";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  mslAnalyticsSales: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  listPins: vi.fn(),
  createPin: vi.fn(),
  deletePin: vi.fn(),
  listReportSpecs: vi.fn(),
  createReportSpec: vi.fn(),
  deleteReportSpec: vi.fn(),
  previewCustomReport: vi.fn(),
  saveCustomReport: vi.fn(),
  generateReportDeck: vi.fn(),
  downloadSavedReport: vi.fn(),
  getLots: vi.fn(),
  getBylawsClause: vi.fn(),
  getAgentUsage: vi.fn(),
}));
const auth = vi.hoisted(() => ({ roles: [] as string[] }));
/** An in-memory stand-in for the pins endpoints. */
const server = vi.hoisted(() => ({ pins: [] as Record<string, unknown>[] }));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const spec: ChartSpec = {
  type: "bar", title: "Average price by broker", subtitle: "Last 12 sales", unit: "Rs/kg", categoryAxis: "Broker",
  categories: ["ASC", "FW", "BC"], series: [{ name: "Avg", values: [1200, 1100, 980] }],
};
const chartReply = `Scope: last 12 sales.\n\`\`\`asc-chart\n${JSON.stringify(spec)}\n\`\`\`\nASC leads.`;
const preview: CustomPreview = {
  title: "Average price (Rs/kg) by broker", scope: "all brokers · the last 12 sales", metric: "m", unit: "Rs/kg", additive: false, split: false,
  categoryAxis: "Broker", categories: ["ASC", "FW"], series: [{ name: "m", values: [1200, 1100] }], markdownTable: "| a |\n|---|\n| 1 |",
};
const lot = (over: Partial<Lot> = {}): Lot =>
  ({ id: "l1", rowKey: "k", lotNumber: "1204", broker: "FORBES", grade: "BOPF", garden: "Kenilworth", netWeight: 1200, rawData: {},
    valuation: { valuationFrom: 1100, valuationTo: 1300, valuationSingle: null }, ...over }) as unknown as Lot;

const reply = (over: Record<string, unknown> = {}) => ({ conversationId: "c1", reply: "Plain answer.", provider: "local", agent: "general", ...over });

beforeEach(() => {
  auth.roles = [];
  server.pins = [];
  window.localStorage.clear();
  window.history.pushState({}, "", "/assistant");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  window.open = vi.fn();

  api.getProviderStatuses.mockReset().mockResolvedValue([{ key: "local", displayName: "Local", configured: true }]);
  api.mslAnalyticsSales.mockReset().mockResolvedValue([{ year: 2026, saleNo: 32 }]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue(reply());
  api.listPins.mockReset().mockImplementation(async () => [...server.pins]);
  api.createPin.mockReset().mockImplementation(async (p: { key: string; kind: string; title: string; chartJson: string | null; text: string | null }) => {
    if (server.pins.some((x) => x.key === p.key)) return { status: "exists", pin: server.pins.find((x) => x.key === p.key) };
    if (server.pins.length >= 12) return { status: "full", pin: null };
    const pin = { id: `srv-${server.pins.length + 1}`, ...p, pinnedAt: "2026-09-20T00:00:00Z" };
    server.pins = [pin, ...server.pins];
    return { status: "added", pin };
  });
  api.deletePin.mockReset().mockImplementation(async (id: string) => {
    server.pins = server.pins.filter((x) => x.id !== id);
  });
  api.listReportSpecs.mockReset().mockResolvedValue([]);
  api.createReportSpec.mockReset();
  api.deleteReportSpec.mockReset().mockResolvedValue(undefined);
  api.previewCustomReport.mockReset().mockResolvedValue(preview);
  api.saveCustomReport.mockReset().mockResolvedValue({ id: "saved-1" });
  api.generateReportDeck.mockReset().mockResolvedValue({ id: "deck-1" });
  api.downloadSavedReport.mockReset().mockResolvedValue({ blob: new Blob(["x"]), fileName: "deck.pptx" });
  api.getLots.mockReset().mockResolvedValue({ rows: [lot()], total: 1, page: 1, pageSize: 3 });
  api.getBylawsClause.mockReset().mockResolvedValue({ title: "Default penalties", text: "1% per day for days 1-3.", lastVerified: "2026-01-01", caveat: "The original PDF is authoritative." });
  api.getAgentUsage.mockReset().mockResolvedValue([]);
});

const open = async () => {
  render(<UniversalAssistant />);
  await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
};
const box = () => screen.getByRole("textbox", { name: "Message" });
const send = async (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
};

describe("one conversation", () => {
  it("is a single chat — no agent to pick — with the essentials in the header", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "AI Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toBeInTheDocument();
    // no per-agent switcher any more
    expect(screen.queryByRole("navigation", { name: "Switch agent" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((b) => /Compare brokers over|top prices|default penalty|weekly broker report/.test(b.textContent ?? ""))).toHaveLength(4);
  });

  it("asks with agent 'auto', so the assistant chooses; the sale and provider go along", async () => {
    await open();
    await send("Compare brokers over the last 12 sales");
    await screen.findByText("Plain answer.");
    const [agent, message, conv, provider, catalogueId, , previous] = api.sendAgentChatMessage.mock.calls[0];
    expect([agent, message, conv, provider, catalogueId, previous]).toEqual(["auto", "Compare brokers over the last 12 sales", undefined, "local", "cat-39", undefined]);
  });

  it("keeps a follow-up with the agent that answered last", async () => {
    api.sendAgentChatMessage.mockResolvedValueOnce(reply({ agent: "analytics" })).mockResolvedValueOnce(reply({ agent: "analytics" }));
    await open();
    await send("Compare brokers over the last 12 sales");
    await screen.findByText("Plain answer.");
    await send("and for FW?");
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendAgentChatMessage.mock.calls[1][6]).toBe("analytics");
    expect(api.sendAgentChatMessage.mock.calls[1][2]).toBe("c1"); // the same conversation
  });

  it("sends a question handed over in the URL once, and only prefills a plain ?q=", async () => {
    window.history.pushState({}, "", "/assistant?send=1&q=Who%20won%3F");
    await open();
    await screen.findByText("Plain answer.");
    expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(1);
    expect(api.sendAgentChatMessage.mock.calls[0][1]).toBe("Who won?");
    expect(window.location.search).toBe("");
  });

  it("prefills, never sends, a question from the dashboard's Ask box", async () => {
    window.history.pushState({}, "", "/assistant?q=draft%20text");
    await open();
    await waitFor(() => expect(box()).toHaveValue("draft text"));
    expect(api.sendAgentChatMessage).not.toHaveBeenCalled();
  });

  it("returns the text and says why when a send fails", async () => {
    api.sendAgentChatMessage.mockRejectedValueOnce(new Error("boom"));
    await open();
    await send("keep me");
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    await waitFor(() => expect(box()).toHaveValue("keep me"));
  });
});

describe("agent tag and clarifying questions", () => {
  it("shows which specialist answered, and re-asks the same question with another on request", async () => {
    api.sendAgentChatMessage.mockResolvedValueOnce(reply({ agent: "analytics" })).mockResolvedValueOnce(reply({ agent: "auction", reply: "Second answer." }));
    await open();
    await send("Which garden did best?");
    await screen.findByText("Plain answer.");

    fireEvent.click(screen.getByRole("button", { name: "Answered by Analytics" }));
    expect(screen.queryByRole("menuitem", { name: "Ask Analytics instead" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ask Auction instead" }));

    await screen.findByText("Second answer.");
    expect(api.sendAgentChatMessage.mock.calls[1].slice(0, 2)).toEqual(["auction", "Which garden did best?"]);
    expect(screen.getByRole("button", { name: "Answered by Auction" })).toBeInTheDocument();
  });

  it("shows a clarifying question as buttons (with no agent tag), and the tapped option goes back as the answer", async () => {
    api.sendAgentChatMessage
      .mockResolvedValueOnce(reply({ provider: "router", agent: "analytics", reply: 'What should I compare?\nCLARIFY: {"question":"What should I compare?","options":["Brokers","Grades"]}' }))
      .mockResolvedValueOnce(reply({ agent: "analytics", reply: "Here you go." }));
    await open();
    await send("Compare performance");
    const option = await screen.findByRole("button", { name: "Brokers" });
    expect(screen.queryByRole("button", { name: /Answered by/ })).not.toBeInTheDocument();

    fireEvent.click(option);
    await screen.findByText("Here you go.");
    expect(api.sendAgentChatMessage.mock.calls[1][1]).toBe("Brokers");
    expect(api.sendAgentChatMessage.mock.calls[1][6]).toBe("analytics"); // continues with the agent the router named
  });
});

describe("charts in the conversation", () => {
  const withChart = async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ agent: "analytics", reply: chartReply }));
    await open();
    await send("Compare brokers over the last 12 sales");
    await screen.findByRole("button", { name: "Explain this chart" });
  };

  it("offers every action on the chart, including opening it in the report canvas", async () => {
    await withChart();
    for (const name of ["Explain this chart", "Pin", "Excel", "PDF", "Save", "PowerPoint", "Edit in report canvas"])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Drill down" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["ASC", "FW", "BC"]);
  });

  it("explains a chart by sending its own figures, and drills into a category", async () => {
    await withChart();
    fireEvent.click(screen.getByRole("button", { name: "Explain this chart" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendAgentChatMessage.mock.calls[1][1]).toContain("FW: Avg=1100");

    fireEvent.click(within(screen.getAllByRole("group", { name: "Drill down" })[0]).getByRole("button", { name: "FW" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(3));
    expect(api.sendAgentChatMessage.mock.calls[2][1]).toContain('Drill into "FW"');
  });

  it("saves a snapshot once, then opens the print page for PDF from the same snapshot", async () => {
    await withChart();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(api.saveCustomReport).toHaveBeenCalledTimes(1);
    expect(api.saveCustomReport.mock.calls[0][0]).toBe("Average price by broker");
    expect(api.saveCustomReport.mock.calls[0][1]).toContain("```asc-chart");
    expect(api.saveCustomReport.mock.calls[0][1]).toContain("| ASC | 1,200 |");

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("/print/custom-report?id=saved-1", "_blank", "noopener"));
    expect(api.saveCustomReport).toHaveBeenCalledTimes(1);
  });

  it("builds a one-report PowerPoint from the chart and downloads it", async () => {
    await withChart();
    fireEvent.click(screen.getByRole("button", { name: "PowerPoint" }));
    await waitFor(() => expect(api.downloadSavedReport).toHaveBeenCalledWith("deck-1"));
    const req = api.generateReportDeck.mock.calls[0][0];
    expect(req).toMatchObject({ title: "Average price by broker", template: "ivory", maxSlides: 3 });
    expect(req.reports[0]).toMatchObject({ categories: ["ASC", "FW", "BC"], visual: "bar", scope: "Last 12 sales" });
    expect(await screen.findByText("PowerPoint downloaded.")).toBeInTheDocument();
  });

  it("pins the chart to your library on the server, and the library shows it", async () => {
    await withChart();
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByText("Pinned to your library.")).toBeInTheDocument();
    expect(server.pins).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Pinned" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    const library = await screen.findByRole("region", { name: "Pinned insights" });
    await waitFor(() => expect(within(library).getByText("1/12")).toBeInTheDocument());
  });

  it("opens the report canvas seeded from what was asked, with figures from the archive", async () => {
    await withChart(); // asked: "Compare brokers over the last 12 sales"
    fireEvent.click(screen.getByRole("button", { name: "Edit in report canvas" }));

    const canvas = await screen.findByRole("dialog", { name: "Report canvas" });
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalled());
    expect(api.previewCustomReport.mock.calls[0][0]).toMatchObject({ groupBy: "broker", lastNSales: 12 });
    expect(await within(canvas).findByRole("heading", { name: "Average price (Rs/kg) by broker" })).toBeInTheDocument();

    // the canvas is the report tools, not another chat
    expect(within(canvas).queryByRole("textbox", { name: "Describe it" })).not.toBeInTheDocument();
    for (const name of ["Download Excel", "Open PDF", "Save snapshot", "Generate PowerPoint", "Schedule weekly"])
      expect(within(canvas).getByRole("button", { name })).toBeInTheDocument();

    fireEvent.click(within(canvas).getByRole("button", { name: "Close the report canvas" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Report canvas" })).not.toBeInTheDocument());
  });

  it("opens the canvas empty-handed from the header, starting from the default report", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Report canvas" }));
    await screen.findByRole("dialog", { name: "Report canvas" });
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalled());
    expect(api.previewCustomReport.mock.calls[0][0]).toMatchObject({ groupBy: "broker", metric: "avg_price_rs", lastNSales: 12 });
  });
});

describe("lots in the conversation", () => {
  it("shows the lot a question is about as a card with Explain / Compare / Price ladder", async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ agent: "auction", reply: "Lot 1204 is valued on liquor." }));
    await open();
    await send("What is the valuation of lot 1204?");
    await screen.findByText("Lot 1204 is valued on liquor.");

    const lots = await screen.findByRole("list", { name: "Lots" });
    expect(api.getLots).toHaveBeenCalledWith("cat-39", { search: "1204", pageSize: 3 });
    expect(within(lots).getByText("Kenilworth")).toBeInTheDocument();
    expect(within(lots).getByText("Rs 1,100 – 1,300")).toBeInTheDocument();

    // a single matching lot opens by itself
    fireEvent.click(within(lots).getByRole("button", { name: "Explain valuation" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendAgentChatMessage.mock.calls[1][1]).toContain("lot 1204");
  });

  it("shows the top three lots of the grade as a price ladder, marked as valuations", async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ agent: "auction" }));
    api.getLots
      .mockResolvedValueOnce({ rows: [lot()], total: 1, page: 1, pageSize: 3 })
      .mockResolvedValueOnce({ rows: [lot({ id: "t1", lotNumber: "900", garden: "Top A" }), lot({ id: "t2", lotNumber: "901", garden: "Top B" }), lot({ id: "t3", lotNumber: "902", garden: "Top C" })], total: 9, page: 1, pageSize: 3 });
    await open();
    await send("valuation of lot 1204");
    fireEvent.click(await screen.findByRole("button", { name: "Price ladder" }));

    const ladder = (await screen.findByText(/Top 3 BOPF lots by valuation/)).closest(".ws-ladder") as HTMLElement;
    expect(api.getLots).toHaveBeenLastCalledWith("cat-39", { grade: "BOPF", sortKey: "Valuation", sortDir: -1, pageSize: 3 });
    expect(within(ladder).getAllByRole("listitem")).toHaveLength(3);
    expect(within(ladder).getByText(/Valuations, not achieved prices/)).toBeInTheDocument();
  });

  it("shows no lot card when the question names no lot, or the sale has no such lot", async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ agent: "auction" }));
    await open();
    await send("Which garden had the top prices?");
    await screen.findByText("Plain answer.");
    expect(screen.queryByRole("list", { name: "Lots" })).not.toBeInTheDocument();
    expect(api.getLots).not.toHaveBeenCalled();
  });
});

describe("sources, library and admin extras", () => {
  it("shows source chips under an answer, and opens a cited by-law clause", async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ sources: [{ kind: "bylaws", label: "CTTA By-Laws", detail: "Default penalties" }, { kind: "catalogue", label: "Sale catalogue data" }] }));
    await open();
    await send("What is the default penalty?");
    await screen.findByText("Plain answer.");

    const list = screen.getByRole("list", { name: "Sources" });
    expect(within(list).getByText("Source · Sale catalogue data")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Open by-law section Default penalties" }));
    const dialog = await screen.findByRole("dialog", { name: /CTTA By-Laws · Default penalties/ });
    expect(await within(dialog).findByText("1% per day for days 1-3.")).toBeInTheDocument();
  });

  it("pins a written answer, and the library removes it and lists scheduled reports", async () => {
    api.listReportSpecs.mockResolvedValue([{ id: "s1", title: "Weekly broker prices", request: { groupBy: "broker" }, visual: "bar", createdAt: "2026-09-01T00:00:00Z", lastRunAt: "2026-09-14T06:00:00Z", lastSavedReportId: null, lastError: null }]);
    await open();
    await send("Explain the deposit rule");
    await screen.findByText("Plain answer.");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByText("Pinned to your library.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    const drawer = await screen.findByRole("dialog", { name: "Library" });
    expect(await within(drawer).findByText("Weekly broker prices")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: /^Unpin / }));
    await waitFor(() => expect(server.pins).toHaveLength(0));
    fireEvent.click(within(drawer).getByRole("button", { name: "Stop scheduling Weekly broker prices" }));
    await waitFor(() => expect(api.deleteReportSpec).toHaveBeenCalledWith("s1"));
    expect(within(drawer).getByRole("link", { name: "Open Saved Reports" })).toHaveAttribute("href", "/saved-reports");
    expect(within(drawer).getByRole("link", { name: "Open the classic chat" })).toHaveAttribute("href", "/assistant/classic");
  });

  it("stops at a full library instead of dropping an old pin", async () => {
    server.pins = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, key: `answer-${i}`, kind: "answer", title: `Pin ${i}`, chartJson: null, text: "t", pinnedAt: "2026-01-01" }));
    await open();
    await send("Explain the deposit rule");
    await screen.findByText("Plain answer.");
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByText(/library is full/)).toBeInTheDocument();
  });

  it("moves pins an earlier version kept in this browser onto the server, once", async () => {
    const chart = { type: "bar", title: "Old chart", unit: "kg", categories: ["A", "B"], series: [{ name: "s", values: [1, 2] }] };
    window.localStorage.setItem("asc.analytics.pins", JSON.stringify([
      { id: "chart-old", kind: "chart", title: "Old chart", chart, pinnedAt: "2026-01-01" },
      { id: "answer-old", kind: "answer", title: "Old answer", text: "Forbes led.", pinnedAt: "2026-01-02" },
    ]));
    await open();
    await waitFor(() => expect(server.pins.map((p) => p.key).sort()).toEqual(["answer-old", "chart-old"]));
    expect(window.localStorage.getItem("asc.analytics.pins")).toBeNull();
  });

  it("skips a pin whose chart can't be read, and says so when a pin can't be saved", async () => {
    server.pins = [{ id: "bad", key: "chart-x", kind: "chart", title: "Broken", chartJson: "{not json", text: null, pinnedAt: "2026-01-01" }];
    api.sendAgentChatMessage.mockResolvedValue(reply());
    await open();
    await send("Explain the deposit rule");
    await screen.findByText("Plain answer.");
    api.createPin.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByText(/Couldn't pin that/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    const board = await screen.findByRole("region", { name: "Pinned insights" });
    expect(within(board).getByText(/Pin a chart or answer/)).toBeInTheDocument(); // the broken one is not shown
  });

  it("tells the reader where the archive stops relative to the active sale", async () => {
    await open();
    expect(await screen.findByRole("note")).toHaveTextContent("Archive figures run to sale 32/2026; the active sale (39/2026) is answered from its catalogue.");
  });

  it("shows an admin the last week's total usage, and shows nobody else", async () => {
    auth.roles = ["Admin"];
    api.getAgentUsage.mockResolvedValue([
      { agent: "general", callCount: 40, failureCount: 1, promptTokens: 1, completionTokens: 1, estimatedCostUsd: 0.3 },
      { agent: "reports", callCount: 2, failureCount: 0, promptTokens: 1, completionTokens: 1, estimatedCostUsd: null },
    ]);
    const first = render(<UniversalAssistant />);
    expect(await screen.findByLabelText("Usage over the last 7 days: 42 calls · $0.30")).toBeInTheDocument();
    first.unmount();

    auth.roles = [];
    api.getAgentUsage.mockClear();
    render(<UniversalAssistant />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText(/Usage over the last/)).not.toBeInTheDocument();
    expect(api.getAgentUsage).not.toHaveBeenCalled();
  });
});

describe("accessibility (structural)", () => {
  it("has no axe violations at rest, with a chart and lot open, and with the drawers open", async () => {
    api.sendAgentChatMessage.mockResolvedValue(reply({ agent: "analytics", reply: chartReply, sources: [{ kind: "archive", label: "MSL auction archive" }] }));
    const { container } = render(<UniversalAssistant />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    const check = async (root: Element) =>
      (await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } }, resultTypes: ["violations"] })).violations.map(
        (v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`,
      );
    expect(await check(container)).toEqual([]);

    await send("Compare brokers over the last 12 sales");
    await screen.findByRole("button", { name: "Explain this chart" });
    expect(await check(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    await screen.findByRole("dialog", { name: "Library" });
    expect(await check(document.body)).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close the library" })));
  });
});
