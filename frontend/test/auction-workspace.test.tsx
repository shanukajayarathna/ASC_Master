import AuctionWorkspace from "@/components/agent-hub/AuctionWorkspace";
import { comparePrompt, explainPrompt, valuationLabel } from "@/components/agent-hub/LotLookup";
import type { Lot } from "@/types/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  getLots: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const catalogue = vi.hoisted(() => ({ id: "cat-39" as string | null }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({
    activeCatalogue: catalogue.id ? { sourceName: "Sale 39 - 2026", rowCount: 10 } : null,
    activeCatalogueId: catalogue.id,
    loading: false,
  }),
}));

const lot = (over: Partial<Lot> = {}): Lot =>
  ({
    id: "l1", rowKey: "k1", lotNumber: "1204", broker: "FORBES", grade: "BOPF", garden: "Kenilworth", category: "High", elevation: null,
    region: null, warehouse: null, mark: null, saleNo: "39", saleYear: "2026", invoiceNo: null, netWeight: 1200, grossWeight: null, rawData: {},
    valuation: { valuationFrom: 1100, valuationTo: 1300, valuationSingle: null, classification: null, standardData: null, adjectiveData: null, liquorRemarks: null, musterReport: null, brokerNotes: null, privateNotes: null, updatedAt: null },
    ...over,
  }) as unknown as Lot;

beforeEach(() => {
  catalogue.id = "cat-39";
  api.getProviderStatuses.mockReset().mockResolvedValue([{ key: "local", displayName: "Local", configured: true }]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c1", reply: "Because of the liquor.", provider: "local" });
  api.getLots.mockReset().mockResolvedValue({ rows: [lot(), lot({ id: "l2", lotNumber: "1205", garden: "Somerset", valuation: null })], total: 2, page: 1, pageSize: 8 });
  window.history.pushState({}, "", "/assistant/auction");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("lot helpers", () => {
  it("formats a range, a single value, and no valuation", () => {
    expect(valuationLabel(lot())).toBe("Rs 1,100 – 1,300");
    expect(valuationLabel(lot({ valuation: { ...lot().valuation!, valuationFrom: null, valuationTo: null, valuationSingle: 950 } }))).toBe("Rs 950");
    expect(valuationLabel(lot({ valuation: null }))).toBeNull();
  });

  it("asks precise, read-only questions about the chosen lot", () => {
    expect(explainPrompt(lot())).toContain("lot 1204");
    expect(explainPrompt(lot())).toContain("Kenilworth");
    expect(comparePrompt(lot())).toContain("BOPF");
    expect(comparePrompt(lot())).toContain("FORBES");
  });
});

describe("AuctionWorkspace", () => {
  it("uses the shared shell with Auction current and the sale in context", async () => {
    render(<AuctionWorkspace />);
    expect(screen.getByRole("heading", { level: 1, name: "Auction" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Auction", current: "page" })).toBeInTheDocument();
    expect(screen.getByText("Sale 39 - 2026")).toBeInTheDocument();
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
  });

  it("searches the active sale after a short pause and lists lot cards", async () => {
    render(<AuctionWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: " 1204 " } });

    expect(await screen.findByText("Kenilworth")).toBeInTheDocument();
    expect(screen.getByText("Rs 1,100 – 1,300")).toBeInTheDocument();
    expect(screen.getByText("Not valued yet")).toBeInTheDocument();
    expect(api.getLots).toHaveBeenCalledTimes(1);
    expect(api.getLots).toHaveBeenCalledWith("cat-39", { search: "1204", pageSize: 8 });
  });

  it("explains a chosen lot's valuation through the Auction agent, with the sale attached", async () => {
    render(<AuctionWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "ken" } });
    fireEvent.click(await screen.findByRole("button", { name: /Kenilworth/ }));
    fireEvent.click(screen.getByRole("button", { name: "Explain valuation" }));

    expect(await screen.findByText("Because of the liquor.")).toBeInTheDocument();
    const [agent, message, , , catalogueId] = api.sendAgentChatMessage.mock.calls[0];
    expect(agent).toBe("auction");
    expect(message).toContain("lot 1204");
    expect(catalogueId).toBe("cat-39");
  });

  it("offers the grade-and-broker comparison for a chosen lot", async () => {
    render(<AuctionWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "ken" } });
    fireEvent.click(await screen.findByRole("button", { name: /Kenilworth/ }));
    fireEvent.click(screen.getByRole("button", { name: /Compare with grade/ }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalled());
    expect(api.sendAgentChatMessage.mock.calls[0][1]).toContain("BOPF");
  });

  it("says so when nothing matches, and when the search fails", async () => {
    api.getLots.mockResolvedValueOnce({ rows: [], total: 0, page: 1, pageSize: 8 });
    render(<AuctionWorkspace />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "zzz" } });
    // not claimed while the search is still pending
    expect(screen.queryByText(/No lots match/)).not.toBeInTheDocument();
    expect(await screen.findByText(/No lots match/)).toBeInTheDocument();
    expect(api.getLots).toHaveBeenCalledTimes(1);

    api.getLots.mockRejectedValueOnce(new Error("down"));
    fireEvent.change(screen.getByRole("textbox", { name: "Search lots" }), { target: { value: "yyy" } });
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent("Couldn't search lots");
  });

  it("asks for a sale when none is selected, and does not search", () => {
    catalogue.id = null;
    render(<AuctionWorkspace />);
    expect(screen.getByText(/Pick a sale in the top bar/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search lots" })).toBeDisabled();
    expect(api.getLots).not.toHaveBeenCalled();
  });

  it("has the Auction agent's suggested prompts in the chat", async () => {
    render(<AuctionWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Show me the top prices" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalled());
    expect(api.sendAgentChatMessage.mock.calls[0].slice(0, 2)).toEqual(["auction", "Show me the top prices"]);
  });
});
