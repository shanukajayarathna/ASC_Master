import AuctionWorkspace from "@/components/agent-hub/AuctionWorkspace";
import GeneralWorkspace from "@/components/agent-hub/GeneralWorkspace";
import ReportsWorkspace from "@/components/agent-hub/ReportsWorkspace";
import AnalyticsWorkspace from "@/components/agent-hub/AnalyticsWorkspace";
import { archiveGap, parseSaleName } from "@/components/agent-hub/archive";
import { handoffHref, suggestSpecialist } from "@/components/agent-hub/handoff";
import { effectiveValue } from "@/components/agent-hub/LotLookup";
import { REPORT_TEMPLATES } from "@/components/agent-hub/reportTemplates";
import type { CustomPreview, Lot } from "@/types/api";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  mslAnalyticsSales: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  previewCustomReport: vi.fn(),
  getLots: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { roles: [] } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026 · 10,850 lots", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const preview: CustomPreview = {
  title: "Average price by broker", scope: "all brokers", metric: "m", unit: "Rs/kg", additive: false, split: false, categoryAxis: "Broker",
  categories: ["ASC"], series: [{ name: "m", values: [1] }], markdownTable: "| a |\n|---|\n| 1 |",
};
const lot = (over: Partial<Lot> = {}): Lot =>
  ({ id: "l1", rowKey: "k", lotNumber: "1204", broker: "FORBES", grade: "BOPF", garden: "Kenilworth", netWeight: 1, rawData: {},
    valuation: { valuationFrom: 1100, valuationTo: 1300, valuationSingle: null }, ...over }) as unknown as Lot;

beforeEach(() => {
  api.getProviderStatuses.mockReset().mockResolvedValue([]);
  api.mslAnalyticsSales.mockReset().mockResolvedValue([
    { year: 2026, saleNo: 0 }, { year: 2026, saleNo: 32 }, { year: 2026, saleNo: 31 }, { year: 2025, saleNo: 51 },
  ]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c", reply: "ok", provider: "local" });
  api.previewCustomReport.mockReset().mockResolvedValue(preview);
  api.getLots.mockReset().mockResolvedValue({ rows: [lot()], total: 1, page: 1, pageSize: 8 });
  window.localStorage.clear();
  window.history.pushState({}, "", "/assistant/general");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("archive gap", () => {
  it("reads the sale from the catalogue name", () => {
    expect(parseSaleName("Sale 39 - 2026 · 10,850 lots")).toEqual({ saleNo: 39, year: 2026 });
    expect(parseSaleName("sale 5 / 2025")).toEqual({ saleNo: 5, year: 2025 });
    expect(parseSaleName("Weekly catalogue")).toBeNull();
    expect(parseSaleName(null)).toBeNull();
  });

  it("only reports a gap when the active sale is newer than the archive", () => {
    expect(archiveGap({ year: 2026, saleNo: 32 }, { year: 2026, saleNo: 39 })).toEqual({ archived: "32/2026", active: "39/2026" });
    expect(archiveGap({ year: 2025, saleNo: 51 }, { year: 2026, saleNo: 1 })).not.toBeNull();
    expect(archiveGap({ year: 2026, saleNo: 39 }, { year: 2026, saleNo: 39 })).toBeNull();
    expect(archiveGap({ year: 2026, saleNo: 40 }, { year: 2026, saleNo: 39 })).toBeNull();
    expect(archiveGap(null, { year: 2026, saleNo: 39 })).toBeNull(); // unknown archive: say nothing rather than guess
  });

  it("tells Analytics and Reports where the archive stops, and General/Auction how archive questions are covered", async () => {
    const analytics = render(<AnalyticsWorkspace />);
    expect(await screen.findByRole("note")).toHaveTextContent("Archive data runs to sale 32/2026, so these figures stop there");
    analytics.unmount();

    render(<AuctionWorkspace />);
    expect(await screen.findByRole("note")).toHaveTextContent("Archive questions cover up to sale 32/2026; the active sale (39/2026)");
  });

  it("shows nothing when the archive is current or cannot be read", async () => {
    api.mslAnalyticsSales.mockRejectedValue(new Error("down"));
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.mslAnalyticsSales).toHaveBeenCalled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("hand-off from General", () => {
  it("suggests the right specialist by keyword, and nothing for ordinary questions", () => {
    expect(suggestSpecialist("Build me a PowerPoint of broker prices")?.agent).toBe("reports");
    expect(suggestSpecialist("Compare brokers over the last 12 sales")?.agent).toBe("analytics");
    expect(suggestSpecialist("What is the valuation of lot 1204?")?.agent).toBe("auction");
    expect(suggestSpecialist("Explain the deposit rule")).toBeNull();
    // a report request outranks the archive words in it
    expect(suggestSpecialist("Export the broker trend to Excel")?.agent).toBe("reports");
  });

  it("builds a link that carries the question to the specialist", () => {
    expect(handoffHref("analytics", "trend for BOPF?")).toBe("/assistant/analytics?send=1&q=trend%20for%20BOPF%3F");
  });

  it("offers the hand-off under the conversation after a matching question, and not otherwise", async () => {
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    const box = () => screen.getByRole("textbox", { name: "Message" });

    fireEvent.change(box(), { target: { value: "Explain the deposit rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("ok");
    expect(screen.queryByText(/This looks like/)).not.toBeInTheDocument();

    fireEvent.change(box(), { target: { value: "Compare brokers over the last 12 sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const note = await screen.findByText(/This looks like comparing brokers/);
    const link = within(note.closest("p")!).getByRole("link", { name: "Analytics agent" });
    expect(link).toHaveAttribute("href", "/assistant/analytics?send=1&q=Compare%20brokers%20over%20the%20last%2012%20sales");
  });
});

describe("Reports templates", () => {
  it("are plain builder choices, each different from the last", () => {
    expect(REPORT_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(REPORT_TEMPLATES.map((t) => JSON.stringify(t.state))).size).toBe(REPORT_TEMPLATES.length);
  });

  it("set the builder in one click and re-query the archive", async () => {
    render(<ReportsWorkspace />);
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Weekly volume trend" }));
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(2));
    expect(api.previewCustomReport.mock.calls[1][0]).toMatchObject({ groupBy: "sale", metric: "sold_quantity_kg", topN: 12, lastNSales: 12 });

    fireEvent.click(screen.getByRole("button", { name: "Latest sale proceeds" }));
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(3));
    expect(api.previewCustomReport.mock.calls[2][0]).toMatchObject({ groupBy: "broker", metric: "proceeds_rs" });
    expect(api.previewCustomReport.mock.calls[2][0].lastNSales).toBeUndefined();
  });
});

describe("Auction price ladder", () => {
  it("values a lot as its single value or the middle of its range", () => {
    expect(effectiveValue(lot())).toBe(1200);
    expect(effectiveValue(lot({ valuation: { valuationSingle: 950, valuationFrom: null, valuationTo: null } as Lot["valuation"] }))).toBe(950);
    expect(effectiveValue(lot({ valuation: null }))).toBeNull();
  });

  it("shows the top three lots of the grade by valuation, with this lot marked, and says they are valuations", async () => {
    api.getLots
      .mockResolvedValueOnce({ rows: [lot()], total: 1, page: 1, pageSize: 8 }) // the search
      .mockResolvedValueOnce({
        rows: [lot({ id: "t1", lotNumber: "900", garden: "Top A" }), lot({ id: "t2", lotNumber: "901", garden: "Top B" }), lot({ id: "t3", lotNumber: "902", garden: "Top C" })],
        total: 9, page: 1, pageSize: 3,
      });
    render(<AuctionWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "ken" } });
    fireEvent.click(await screen.findByRole("button", { name: /Kenilworth/ }));
    fireEvent.click(screen.getByRole("button", { name: "Price ladder" }));

    const ladder = await screen.findByText(/Top 3 BOPF lots by valuation/);
    expect(api.getLots).toHaveBeenLastCalledWith("cat-39", { grade: "BOPF", sortKey: "Valuation", sortDir: -1, pageSize: 3 });
    const box = ladder.closest(".ws-ladder") as HTMLElement;
    expect(within(box).getAllByRole("listitem")).toHaveLength(3);
    expect(within(box).getByText("This lot: Rs 1,100 – 1,300")).toBeInTheDocument(); // not in the top three
    expect(within(box).getByText(/Valuations, not achieved prices/)).toBeInTheDocument();
  });

  it("says so if the ladder cannot be loaded", async () => {
    api.getLots.mockResolvedValueOnce({ rows: [lot()], total: 1, page: 1, pageSize: 8 }).mockRejectedValueOnce(new Error("x"));
    render(<AuctionWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "ken" } });
    fireEvent.click(await screen.findByRole("button", { name: /Kenilworth/ }));
    fireEvent.click(screen.getByRole("button", { name: "Price ladder" }));
    expect(await screen.findByText(/Couldn't load the ladder/)).toBeInTheDocument();
  });
});
