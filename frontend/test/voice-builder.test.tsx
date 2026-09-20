import ReportsWorkspace from "@/components/agent-hub/ReportsWorkspace";
import VoiceBuilder from "@/components/agent-hub/VoiceBuilder";
import { DEFAULT_STATE, toRequest } from "@/components/agent-hub/reportBuilder";
import { SAMPLE_LINE, applyVoiceCommand, parseVoiceCommand } from "@/components/agent-hub/voiceCommand";
import type { CustomPreview } from "@/types/api";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { roles: [] } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/context/CatalogueContext", () => ({
  useCatalogue: () => ({ activeCatalogue: { sourceName: "Sale 39 - 2026", rowCount: 10 }, activeCatalogueId: "cat-39", loading: false }),
}));

const preview: CustomPreview = {
  title: "Average price (Rs/kg) by broker", scope: "all brokers · the last 12 sales", metric: "Average price (Rs/kg)", unit: "Rs/kg",
  additive: false, split: false, categoryAxis: "Broker", categories: ["ASC", "FW"], series: [{ name: "Average price (Rs/kg)", values: [1200, 1100] }],
  markdownTable: "| Broker | Avg |\n|---|---|\n| ASC | 1,200 |",
};

/** A controllable stand-in for the browser's speech recognition. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() { this.started++; }
  stop() { this.stopped++; this.onend?.(); }
  abort() {}
  say(text: string) { this.onresult?.({ results: [[{ transcript: text }]] }); }
}

beforeEach(() => {
  FakeRecognition.last = null;
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
  window.localStorage.clear();
  api.getProviderStatuses.mockReset().mockResolvedValue([]);
  api.previewCustomReport.mockReset().mockResolvedValue(preview);
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe("parseVoiceCommand", () => {
  it("understands the sample line and asks for a deck", () => {
    const c = parseVoiceCommand(SAMPLE_LINE);
    expect(c.patch).toMatchObject({ group: "broker", grades: ["BOPF"], period: "12" });
    expect(c.wantsDeck).toBe(true);
    expect(c.understood).toEqual(["Group by brokers", "Grade: BOPF", "Period: last 12 sales", "Then make a deck"]);
  });

  it.each([
    ["Average price by grade for the last four sales", { group: "grade", metric: "avg_price_rs", period: "4" }],
    ["Show proceeds per broker this year as a table", { group: "broker", metric: "proceeds_rs", period: "year", visual: "table" }],
    ["Quantity sold trend for the latest sale as a line", { group: "sale", metric: "sold_quantity_kg", period: "latest", visual: "line" }],
    ["compare origins by lots", { group: "elevation", metric: "sold_lots" }],
  ])("reads %j", (said, expected) => {
    expect(parseVoiceCommand(said).patch).toMatchObject(expected);
  });

  it("does not mistake the sales in 'last 12 sales' for a grouping", () => {
    expect(parseVoiceCommand("average price over the last 12 sales").patch.group).toBeUndefined();
  });

  it("finds named brokers by code or name, and keeps the most specific grade", () => {
    expect(parseVoiceCommand("compare Forbes and Bartleet and Asia Siyaka").patch.brokers).toEqual(["ASC", "FW", "BC"]);
    expect(parseVoiceCommand("brokers for BOPF1").patch.grades).toEqual(["BOPF1"]); // not also BOPF
    expect(parseVoiceCommand("brokers for bopf and op1").patch.grades).toEqual(["BOPF", "OP1"]);
  });

  it("says when a period is not supported instead of ignoring it", () => {
    const c = parseVoiceCommand("brokers over the last 6 sales");
    expect(c.patch.period).toBe("4");
    expect(c.notes[0]).toMatch(/last 4 or the last 12/);
    expect(parseVoiceCommand("brokers over the last 10 sales").patch.period).toBe("12");
  });

  it("recognises nothing in unrelated speech", () => {
    const c = parseVoiceCommand("what a lovely day");
    expect(c.patch).toEqual({});
    expect(c.wantsDeck).toBe(false);
  });

  it("changes only what was said, and clears an old grade filter when the subject changes", () => {
    const filtered = { ...DEFAULT_STATE, grades: ["BOPF"], brokers: ["FW"], period: "4" as const };
    expect(applyVoiceCommand(filtered, parseVoiceCommand("show the table")).grades).toEqual(["BOPF"]);
    const moved = applyVoiceCommand(filtered, parseVoiceCommand("compare grades by proceeds"));
    expect(moved).toMatchObject({ group: "grade", metric: "proceeds_rs", grades: [], period: "4" });
    expect(toRequest({ ...DEFAULT_STATE, grades: ["BOPF"] }).grades).toEqual(["BOPF"]);
  });
});

describe("VoiceBuilder", () => {
  it("records while the button is held and puts the words in the box for review — nothing is applied yet", () => {
    const onApply = vi.fn();
    render(<VoiceBuilder onApply={onApply} />);
    const hold = screen.getByRole("button", { name: "Hold to speak" });

    fireEvent.pointerDown(hold);
    expect(FakeRecognition.last!.started).toBe(1);
    expect(screen.getByRole("button", { name: /Listening/ })).toHaveAttribute("aria-pressed", "true");

    act(() => FakeRecognition.last!.say("compare brokers for BOPF"));
    fireEvent.pointerUp(screen.getByRole("button", { name: /Listening/ }));
    expect(FakeRecognition.last!.stopped).toBe(1);

    expect(screen.getByRole("textbox", { name: "What you said" })).toHaveValue("compare brokers for BOPF");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("works from the keyboard: Space holds, release stops", () => {
    render(<VoiceBuilder onApply={vi.fn()} />);
    const hold = screen.getByRole("button", { name: "Hold to speak" });
    fireEvent.keyDown(hold, { key: " " });
    expect(FakeRecognition.last!.started).toBe(1);
    fireEvent.keyDown(screen.getByRole("button", { name: /Listening/ }), { key: " ", repeat: true }); // key repeat must not restart
    expect(FakeRecognition.last!.started).toBe(1);
    fireEvent.keyUp(screen.getByRole("button", { name: /Listening/ }), { key: " " });
    expect(FakeRecognition.last!.stopped).toBe(1);
  });

  it("fills the sample line, applies it, and explains what it understood", () => {
    const onApply = vi.fn();
    render(<VoiceBuilder onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: `“${SAMPLE_LINE}”` }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to builder" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const status = screen.getByRole("status");
    expect(within(status).getByText("Grade: BOPF")).toBeInTheDocument();
    expect(within(status).getByText(/Generate PowerPoint/)).toBeInTheDocument();
  });

  it("does not apply unrecognised speech, and says so", () => {
    const onApply = vi.fn();
    render(<VoiceBuilder onApply={onApply} />);
    fireEvent.change(screen.getByRole("textbox", { name: "What you said" }), { target: { value: "hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to builder" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/didn.t recognise a report request/i)).toBeInTheDocument();
  });

  it("reports microphone problems in words", () => {
    render(<VoiceBuilder onApply={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Hold to speak" }));
    act(() => FakeRecognition.last!.onerror?.({ error: "not-allowed" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone permission was denied");
  });

  it("disables the button where speech recognition does not exist, but typing still works", () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const onApply = vi.fn();
    render(<VoiceBuilder onApply={onApply} />);
    expect(screen.getByRole("button", { name: "Hold to speak" })).toBeDisabled();
    expect(screen.getByText(/isn.t supported in this browser/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "What you said" }), { target: { value: "brokers this year" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to builder" }));
    expect(onApply).toHaveBeenCalled();
  });
});

describe("Voice builder in the Reports workspace", () => {
  it("drives the builder, so the preview re-queries the archive with the spoken choices", async () => {
    render(<ReportsWorkspace />);
    await screen.findByRole("heading", { name: "Average price (Rs/kg) by broker" });
    expect(api.previewCustomReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: `“${SAMPLE_LINE}”` }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to builder" }));

    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(2));
    expect(api.previewCustomReport.mock.calls[1][0]).toMatchObject({ groupBy: "broker", grades: ["BOPF"], lastNSales: 12 });
    expect(screen.getByRole("button", { name: "Remove grade filter BOPF" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove grade filter BOPF" }));
    await waitFor(() => expect(api.previewCustomReport).toHaveBeenCalledTimes(3));
    expect(api.previewCustomReport.mock.calls[2][0].grades).toBeUndefined();
  });
});
