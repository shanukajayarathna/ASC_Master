import GeneralWorkspace from "@/components/agent-hub/GeneralWorkspace";
import VoiceOrb, { ORB_COPY, ORB_STATES } from "@/components/agent-hub/VoiceOrb";
import { speakable } from "@/components/agent-hub/voice";
import { pickProvider } from "@/components/agent-hub/useAgentChat";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProviderStatuses: vi.fn(),
  sendAgentChatMessage: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const catalogue = vi.hoisted(() => ({ loading: false }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: catalogue.loading }),
}));

beforeEach(() => {
  api.getProviderStatuses.mockReset().mockResolvedValue([
    { key: "openai", displayName: "OpenAI", configured: false },
    { key: "local", displayName: "Local", configured: true },
  ]);
  api.sendAgentChatMessage.mockReset().mockResolvedValue({ conversationId: "c1", reply: "Reply one", provider: "local" });
  catalogue.loading = false;
  window.history.pushState({}, "", "/assistant/general");
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("VoiceOrb", () => {
  it.each(ORB_STATES)("renders the %s state as a decorative graphic", (state) => {
    const { container } = render(<VoiceOrb state={state} />);
    const orb = container.querySelector(".voice-orb")!;
    expect(orb).toHaveAttribute("data-state", state);
    expect(orb).toHaveAttribute("aria-hidden", "true");
    expect(ORB_COPY[state].title).not.toBe("");
    expect(ORB_COPY[state].hint).not.toBe("");
  });

  it("follows the level source while listening, and holds still under reduced motion", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => ((frame = cb), 1));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { container, rerender } = render(<VoiceOrb state="listening" getLevel={() => 0.5} />);
    const orb = container.querySelector<HTMLElement>(".voice-orb")!;
    expect(orb.style.getPropertyValue("--lvl")).toBe("0.500");
    expect(frame).not.toBeNull();

    rerender(<VoiceOrb state="listening" getLevel={() => 0.5} reduced />);
    expect(orb.style.getPropertyValue("--lvl")).toBe("0");
    vi.unstubAllGlobals();
  });
});

describe("voice helpers", () => {
  it("strips charts, tables, links and markdown before speech", () => {
    const text = "## Result\n**Top** broker is [Forbes](https://x.io/a)\n| a | b |\n|---|---|\n```asc-chart\n{}\n```\nSee https://x.io now.";
    expect(speakable(text)).toBe("Result Top broker is Forbes See now.");
  });

  it("prefers OpenAI, then local, and only ever picks a configured provider", () => {
    const p = (key: string, configured: boolean) => ({ key, displayName: key, model: null, configured });
    expect(pickProvider([p("openai", true), p("local", true)])).toBe("openai");
    expect(pickProvider([p("openai", false), p("local", true), p("groq", true)])).toBe("local");
    expect(pickProvider([p("custom", true)])).toBe("custom");
    expect(pickProvider([p("openai", false)])).toBeNull();
  });
});

describe("GeneralWorkspace", () => {
  it("has the shared shell: back link, agent name, sale chip and a switcher with General current", async () => {
    render(<GeneralWorkspace />);
    expect(screen.getByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All agents" })).toHaveAttribute("href", "/assistant");
    expect(screen.getByText("Sale 39 - 2026")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Switch agent" });
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "General", current: "page" })).toBeInTheDocument();
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
  });

  it("sends a typed question to the General agent with the sale and provider, and shows the reply", async () => {
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "  Top BOPF?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Reply one")).toBeInTheDocument();
    expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(1);
    const [agent, text, conv, , catalogueId] = api.sendAgentChatMessage.mock.calls[0];
    expect([agent, text, conv, catalogueId]).toEqual(["general", "Top BOPF?", undefined, "cat-39"]);
  });

  it("sends a hub question exactly once, strips it from the URL, and continues the same conversation after", async () => {
    window.history.pushState({}, "", "/assistant/general?send=1&q=Who%20won%3F");
    render(<GeneralWorkspace />);

    expect(await screen.findByText("Reply one")).toBeInTheDocument();
    expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(1);
    expect(api.sendAgentChatMessage.mock.calls[0][1]).toBe("Who won?");
    expect(window.location.search).toBe("");

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "and second?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendAgentChatMessage.mock.calls[1][2]).toBe("c1"); // same conversation
  });

  it("waits for the active sale to load before sending a hub question", async () => {
    catalogue.loading = true;
    window.history.pushState({}, "", "/assistant/general?send=1&q=hi");
    const { rerender } = render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.sendAgentChatMessage).not.toHaveBeenCalled();

    catalogue.loading = false;
    rerender(<GeneralWorkspace />);
    await waitFor(() => expect(api.sendAgentChatMessage).toHaveBeenCalledTimes(1));
  });

  it("prefills (never sends) a ?q= without send=1", async () => {
    window.history.pushState({}, "", "/assistant/general?q=draft%20text");
    render(<GeneralWorkspace />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("draft text"));
    expect(api.sendAgentChatMessage).not.toHaveBeenCalled();
  });

  it("returns the text to the composer and shows an error when a send fails", async () => {
    api.sendAgentChatMessage.mockRejectedValueOnce(new Error("boom"));
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("keep me"));
  });

  it("shows the orb thinking while a reply is pending", async () => {
    let resolve!: (v: unknown) => void;
    api.sendAgentChatMessage.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { container } = render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "slow one" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(container.querySelector(".voice-orb")).toHaveAttribute("data-state", "thinking"));
    resolve({ conversationId: "c2", reply: "done", provider: "local" });
    await waitFor(() => expect(container.querySelector(".voice-orb")).toHaveAttribute("data-state", "idle"));
  });

  it("offers the four suggested prompts and each sends", async () => {
    render(<GeneralWorkspace />);
    await waitFor(() => expect(api.getProviderStatuses).toHaveBeenCalled());
    expect(screen.getAllByRole("button").filter((b) => /Summarise this week|Explain a valuation|Find a by-law|Which agent/.test(b.textContent ?? ""))).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Find a by-law" }));
    await waitFor(() => expect(api.sendAgentChatMessage.mock.calls[0]?.[1]).toBe("Find a by-law"));
  });
});
