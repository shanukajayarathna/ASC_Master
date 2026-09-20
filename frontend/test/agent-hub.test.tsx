import AgentHub from "@/components/agent-hub/AgentHub";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026" } }),
}));

/** matchMedia stub: which queries "match" is decided per test. */
function mockMedia(matching: { compact?: boolean; reduced?: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") ? !!matching.compact : query.includes("prefers-reduced-motion") ? !!matching.reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** The specialist tiles only — PageHeader adds its own Home link and the header has a classic-chat link. */
const tileLinks = () => screen.getAllByRole("link", { name: /^Open the .+ agent$/ });
const box = () => screen.getByRole("textbox", { name: "Your question" });
const askButton = () => screen.getByRole("button", { name: "Ask" });

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  window.localStorage.clear();
  window.history.pushState({}, "", "/assistant");
  mockMedia({});
});
afterEach(() => vi.useRealTimers());

describe("AgentHub: page anatomy", () => {
  it("is an ordinary module page: the shared header, then the ask box, then the specialists", () => {
    render(<AgentHub />);

    expect(screen.getByRole("heading", { level: 1, name: "AI Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ask anything" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Or choose a specialist for one job" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Open classic chat" })).toHaveAttribute("href", "/assistant/classic");
  });

  it("offers three specialists as links to their workspaces — and no separate General tile", () => {
    render(<AgentHub />);

    expect(screen.getByRole("link", { name: "Open the Auction agent" })).toHaveAttribute("href", "/assistant/auction");
    expect(screen.getByRole("link", { name: "Open the Analytics agent" })).toHaveAttribute("href", "/assistant/analytics");
    expect(screen.getByRole("link", { name: "Open the Reports agent" })).toHaveAttribute("href", "/assistant/reports");
    // General is the ask box; a second tile for it would be two ways into the same thing.
    expect(screen.queryByRole("link", { name: "Open the General agent" })).not.toBeInTheDocument();
    expect(tileLinks()).toHaveLength(3);
  });

  it("describes the specialists by the job they do", () => {
    render(<AgentHub />);
    expect(screen.getByText("Look up lots, valuations and prices for the sale.")).toBeInTheDocument();
    expect(screen.getByText("Compare brokers, grades and 13 years of trends.")).toBeInTheDocument();
    expect(screen.getByText("Build a report or deck, then export it.")).toBeInTheDocument();
  });

  it("marks General as where to start", () => {
    render(<AgentHub />);
    expect(screen.getByText("Agent 01 · Start here")).toBeInTheDocument();
  });

  it("lists the specialists in the same order on every screen size", () => {
    render(<AgentHub />);
    expect(tileLinks().map((l) => l.getAttribute("href"))).toEqual(["/assistant/auction", "/assistant/analytics", "/assistant/reports"]);
  });

  it("shows the sale in context and lets the language be switched", () => {
    render(<AgentHub />);
    expect(screen.getByText("Sale 39 - 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Interface language: EN/ }));
    expect(screen.getByRole("heading", { level: 2, name: "ඕනෑම දෙයක් අහන්න" })).toBeInTheDocument();
    expect(window.localStorage.getItem("asc_ui_lang")).toBe("si");
  });
});

describe("AgentHub: the ask box", () => {
  it("cannot be submitted empty or with only spaces", () => {
    render(<AgentHub />);
    expect(askButton()).toBeDisabled();

    fireEvent.change(box(), { target: { value: "    " } });
    expect(askButton()).toBeDisabled();
    fireEvent.submit(box().closest("form")!);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("sends the question straight to the General assistant, trimmed and encoded", () => {
    render(<AgentHub />);

    fireEvent.change(box(), { target: { value: "  Who paid most for BOPF?  " } });
    expect(askButton()).toBeEnabled();
    fireEvent.click(askButton());

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/assistant/classic?agent=general&send=1&q=Who%20paid%20most%20for%20BOPF%3F");
  });

  it("submits on Enter", () => {
    render(<AgentHub />);
    fireEvent.change(box(), { target: { value: "hello" } });
    fireEvent.submit(box().closest("form")!);
    expect(nav.push).toHaveBeenCalledWith("/assistant/classic?agent=general&send=1&q=hello");
  });

  it("offers three suggested questions that each send in one click", () => {
    render(<AgentHub />);

    fireEvent.click(screen.getByRole("button", { name: "Which broker performed best?" }));

    expect(nav.push).toHaveBeenCalledWith("/assistant/classic?agent=general&send=1&q=Which%20broker%20performed%20best%3F");
    expect(screen.getAllByRole("button").filter((b) => /Summarise this week|Which broker|Explain a CTTA/.test(b.textContent ?? ""))).toHaveLength(3);
  });

  it("is a labelled field with a voice button, whose transcript lands for review and is never auto-sent", () => {
    render(<AgentHub />);
    expect(box()).toHaveAttribute("placeholder", "Ask about a lot, a broker, a sale or a by-law…");
    // The mic is present (disabled here because jsdom has no speech recognition, as in Firefox).
    expect(screen.getByRole("button", { name: /voice|speak|mic|not supported/i })).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("reads its labels in Sinhala after switching language", () => {
    render(<AgentHub />);
    fireEvent.click(screen.getByRole("button", { name: /Interface language: EN/ }));
    expect(screen.getByRole("textbox", { name: "ඔබේ ප්‍රශ්නය" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "අහන්න" })).toBeInTheDocument();
  });
});

describe("AgentHub: specialists are plain links", () => {
  it("leave new-tab gestures and navigation to the browser", () => {
    render(<AgentHub />);
    const link = screen.getByRole("link", { name: "Open the Analytics agent" });
    const notPrevented = fireEvent.click(link, { ctrlKey: true });
    expect(notPrevented).toBe(true); // fireEvent returns false when preventDefault was called
    expect(nav.push).not.toHaveBeenCalled();
  });
});
