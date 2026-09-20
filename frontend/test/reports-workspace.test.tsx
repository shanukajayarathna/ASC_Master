import ReportsWorkspace from "@/components/agent-hub/ReportsWorkspace";
import { DEFAULT_STATE, MAX_DECK_SLIDES, chartSpecFrom, deckSlideCount, toDeckReport, safeFileName, snapshotContent, summarize, tableRows, toRequest } from "@/components/agent-hub/reportBuilder";
import type { CustomPreview } from "@/types/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(), mslAnalyticsSales: vi.fn(() => Promise.resolve([])),
  sendAgentChatMessage: vi.fn(),
  previewCustomReport: vi.fn(),
  saveCustomReport: vi.fn(),
  generateReportDeck: vi.fn(),
  downloadSavedReport: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const preview: CustomPreview = {
  title: "Average price (Rs/kg) by broker",
  scope: "all brokers · the last 12 sales, 28/2026–39/2026",
  metric: "Average price (Rs/kg)",
  unit: "Rs/kg",
  additive: false,
  split: false,
  categoryAxis: "Broker",
  categories: ["ASC", "FW", "BC"],
  series: [{ name: "Average price (Rs/kg)", values: [1200, 1100, 980] }],
  markdownTable: "| Broker | Average price (Rs/kg) |\n|---|---|\n| ASC | 1,200 |\n| FW | 1,100 |\n| BC | 980 |",
};

beforeEach(() => {
  api.getProviderStatuses.mockReset().mockResolvedValue([{ key: "local", displayName: "Local", configured: true }]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c1", reply: "Here is the report.", provider: "local" });
  api.previewCustomReport.mockReset().mockResolvedValue(preview);
  api.saveCustomReport.mockReset().mockResolvedValue({ id: "saved-1" });
  api.generateReportDeck.mockReset().mockResolvedValue({ id: "deck-1", type: "custom-deck", title: "x" });
  api.downloadSavedReport.mockReset().mockResolvedValue({ blob: new Blob(["pptx"]), fileName: "deck.pptx" });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  window.open = vi.fn();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("builder logic", () => {
  it("maps the builder onto the archive query", () => {
    const now = new Date("2026-09-20");
    expect(toRequest(DEFAULT_STATE, now)).toEqual({ groupBy: "broker", metric: "avg_price_rs", topN: 8, lastNSales: 12 });
    expect(toRequest({ ...DEFAULT_STATE, period: "4", brokers: ["ASC", "FW"] }, now)).toMatchObject({ lastNSales: 4, brokers: ["ASC", "FW"] });
    expect(toRequest({ ...DEFAULT_STATE, period: "year" }, now)).toMatchObject({ years: [2026] });
    expect(toRequest({ ...DEFAULT_STATE, period: "latest" }, now).lastNSales).toBeUndefined();
    expect(toRequest({ ...DEFAULT_STATE, group: "sale" }, now).topN).toBe(12);
  });

  it("chooses the chart from the visual, with sensible fallbacks", () => {
    expect(chartSpecFrom(preview, "bar")?.type).toBe("bar");
    expect(chartSpecFrom(preview, "line")?.type).toBe("line");
    expect(chartSpecFrom(preview, "table")).toBeNull();
    expect(chartSpecFrom({ ...preview, categories: ["ASC"], series: [{ name: "x", values: [1] }] }, "line")?.type).toBe("bar"); // a line needs two points
    const many = { ...preview, categories: Array.from({ length: 10 }, (_, i) => `G${i}`), series: [{ name: "x", values: Array(10).fill(1) }] };
    expect(chartSpecFrom(many, "bar")?.type).toBe("horizontal_bar");
    expect(chartSpecFrom(preview, "bar")?.subtitle).toBe(preview.scope);
  });

  it("summarises from the dataset's own numbers, ignoring the Other bucket, and totals only additive measures", () => {
    expect(summarize(preview)).toEqual(["Highest: ASC — Rs 1,200", "Lowest: BC — Rs 980"]);
    const additive: CustomPreview = { ...preview, unit: "kg", additive: true, categories: ["ASC", "FW", "Other"], series: [{ name: "q", values: [300, 200, 900] }] };
    expect(summarize(additive)).toEqual(["Highest: ASC — 300 kg", "Lowest: FW — 200 kg", "Total shown: 500 kg"]);
    expect(summarize({ ...preview, series: [] })).toEqual([]);
  });

  it("builds the snapshot markdown (title, scope, chart, table, source) and spreadsheet rows", () => {
    const md = snapshotContent(preview, chartSpecFrom(preview, "bar"));
    expect(md).toContain("## Average price (Rs/kg) by broker");
    expect(md).toContain("```asc-chart");
    expect(md).toContain("| ASC | 1,200 |");
    expect(md).toContain("Source: ASC Intelligence Hub");
    expect(snapshotContent(preview, null)).not.toContain("asc-chart");
    expect(tableRows(preview)).toEqual([["Broker", "Average price (Rs/kg)"], ["ASC", 1200], ["FW", 1100], ["BC", 980]]);
    expect(safeFileName("Average price (Rs/kg) by broker!")).toBe("average-price-rs-kg-by-broker");
  });
});

describe("ReportsWorkspace", () => {
  it("shows the three panes with the report drawn from the archive figures", async () => {
    render(<ReportsWorkspace />);
    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Builder" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Output" })).toBeInTheDocument();

    const paper = screen.getByRole("article", { name: "Report preview" });
    expect(within(paper).getByText(/Placeholder/)).toBeInTheDocument(); // labelled placeholder while loading
    expect(await within(paper).findByRole("heading", { name: "Average price (Rs/kg) by broker" })).toBeInTheDocument();
    expect(within(paper).getAllByText(preview.scope).length).toBeGreaterThan(0); // the chart repeats it, hidden by CSS
    expect(within(paper).getByRole("list", { name: "Summary" })).toHaveTextContent("Highest: ASC");
    expect(within(paper).getByText(/Source: ASC Intelligence Hub/)).toBeInTheDocument();
    expect(api.previewCustomReport).toHaveBeenCalledTimes(1);
    expect(api.previewCustomReport.mock.calls[0][0]).toMatchObject({ groupBy: "broker", lastNSales: 12 });
  });

  it("re-queries the archive when a control changes, once after a short pause", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });

    fireEvent.click(screen.getByRole("button", { name: "Grade" }));
    fireEvent.click(screen.getByRole("button", { name: "Last 4" }));
    fireEvent.click(screen.getByRole("button", { name: "FW" }));
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(2));
    expect(api.previewCustomReport.mock.calls[1][0]).toMatchObject({ groupBy: "grade", lastNSales: 4, brokers: ["FW"] });
  });

  it("says why when the archive has nothing, without inventing numbers", async () => {
    api.previewCustomReport.mockRejectedValue(new Error("No data for that selection."));
    render(<ReportsWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No data for that selection.");
    expect(screen.queryByRole("heading", { name: /by broker/ })).not.toBeInTheDocument();
  });

  it("saves a snapshot once, then shows it as saved", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    fireEvent.click(screen.getByRole("button", { name: "Save snapshot" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(api.saveCustomReport).toHaveBeenCalledTimes(1);
    expect(api.saveCustomReport.mock.calls[0][0]).toBe("Average price (Rs/kg) by broker");
    expect(api.saveCustomReport.mock.calls[0][1]).toContain("```asc-chart");
    expect(screen.getByRole("link", { name: "Open Saved Reports" })).toHaveAttribute("href", "/saved-reports");
  });

  it("opens the print page for PDF, reusing the saved snapshot when nothing changed", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });

    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("/print/custom-report?id=saved-1", "_blank", "noopener"));
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(window.open).toHaveBeenCalledTimes(2));
    expect(api.saveCustomReport).toHaveBeenCalledTimes(1); // second click reused the same snapshot
  });

  it("disables every output until there is a report", async () => {
    api.previewCustomReport.mockReturnValue(new Promise(() => {}));
    render(<ReportsWorkspace />);
    expect(screen.getByRole("button", { name: "Download Excel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save snapshot" })).toBeDisabled();
  });

  it("sends 'Build from description' to the Reports agent and shows its answer", async () => {
    render(<ReportsWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    const build = screen.getByRole("button", { name: "Build from description" });
    expect(build).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Describe it" }), { target: { value: "BOPF share by broker over 6 sales" } });
    fireEvent.click(build);

    expect(await screen.findByText("Here is the report.")).toBeInTheDocument();
    const [agent, message] = api.sendAgentChatMessage.mock.calls[0];
    expect(agent).toBe("reports");
    expect(message).toContain("BOPF share by broker over 6 sales");

    fireEvent.click(screen.getByRole("button", { name: "Save this answer as a report" }));
    await waitFor(() => expect(api.saveCustomReport).toHaveBeenCalledWith("Custom report", "Here is the report."));
  });
});

describe("PowerPoint deck", () => {
  it("counts slides as a title plus a chart and a table per report (a table report has no chart), capped at 12", () => {
    const bar = toDeckReport(preview, "bar");
    const table = toDeckReport(preview, "table");
    expect(deckSlideCount([bar])).toBe(3);
    expect(deckSlideCount([table])).toBe(2);
    expect(deckSlideCount([bar, table, bar])).toBe(1 + 2 + 1 + 2);
    expect(deckSlideCount(Array(9).fill(bar))).toBe(MAX_DECK_SLIDES);
    expect(toDeckReport(preview, "line")).toMatchObject({ visual: "line", categories: preview.categories, unit: "Rs/kg" });
  });

  it("generates a deck from the report on screen, saves it via the backend and downloads the file", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    const card = screen.getByRole("region", { name: "PowerPoint" });

    expect(within(card).getByText("of 3 available (max 12)")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "ASC Ink" }));
    fireEvent.click(within(card).getByRole("button", { name: "Generate PowerPoint" }));

    await waitFor(() => expect(api.generateReportDeck).toHaveBeenCalledTimes(1));
    const req = api.generateReportDeck.mock.calls[0][0];
    expect(req).toMatchObject({ title: "Average price (Rs/kg) by broker", template: "ink", maxSlides: 3 });
    expect(req.reports).toHaveLength(1);
    expect(req.reports[0].categories).toEqual(["ASC", "FW", "BC"]);
    await waitFor(() => expect(api.downloadSavedReport).toHaveBeenCalledWith("deck-1"));
    await waitFor(() => expect(card.textContent).toContain("PowerPoint downloaded (3 slides)"));
  });

  it("builds a longer deck from several reports and lets the slide count be lowered", async () => {
    api.previewCustomReport.mockResolvedValueOnce(preview).mockResolvedValue({ ...preview, title: "Average price (Rs/kg) by grade" });
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    const card = screen.getByRole("region", { name: "PowerPoint" });

    fireEvent.click(within(card).getByRole("button", { name: "Add this report to the deck" }));
    expect(within(card).getByRole("button", { name: "Add this report to the deck" })).toBeDisabled(); // the same report twice is a no-op
    fireEvent.click(within(screen.getByRole("complementary", { name: "Builder" })).getByRole("button", { name: "Grade" }));
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Add this report to the deck" })).toBeEnabled());
    fireEvent.click(within(card).getByRole("button", { name: "Add this report to the deck" }));

    expect(within(card).getByRole("list", { name: "Reports in the deck" }).children).toHaveLength(2);
    expect(within(card).getByText("of 5 available (max 12)")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Fewer slides" }));
    fireEvent.click(within(card).getByRole("button", { name: "Generate PowerPoint" }));

    await waitFor(() => expect(api.generateReportDeck).toHaveBeenCalled());
    const req = api.generateReportDeck.mock.calls[0][0];
    expect(req.maxSlides).toBe(4);
    expect(req.reports).toHaveLength(2);
    expect(req.title).toContain("+ 1 more");
  });

  it("removes a report from the deck and never goes below two slides", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    const card = screen.getByRole("region", { name: "PowerPoint" });
    fireEvent.click(within(card).getByRole("button", { name: "Add this report to the deck" }));
    fireEvent.click(within(card).getByRole("button", { name: "Fewer slides" })); // 3 -> 2
    expect(within(card).getByRole("button", { name: "Fewer slides" })).toBeDisabled();

    fireEvent.click(within(card).getByRole("button", { name: /^Remove .* from the deck$/ }));
    expect(within(card).queryByRole("list", { name: "Reports in the deck" })).not.toBeInTheDocument();
  });

  it("shows the reason when the deck cannot be built, and offers nothing while there is no report", async () => {
    api.generateReportDeck.mockRejectedValue(new Error("A deck can hold at most 5 reports."));
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    const card = screen.getByRole("region", { name: "PowerPoint" });
    fireEvent.click(within(card).getByRole("button", { name: "Generate PowerPoint" }));
    expect(await within(card).findByText("A deck can hold at most 5 reports.")).toBeInTheDocument();
    expect(api.downloadSavedReport).not.toHaveBeenCalled();
  });
});
