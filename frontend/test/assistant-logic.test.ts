import { totalOf, usageLabel } from "@/components/agent-hub/AgentUsageBadge";
import { archiveGap, parseSaleName } from "@/components/agent-hub/archive";
import { specMarkdown, specSnapshot, specToDeckReport, specToPreview } from "@/components/agent-hub/chartExports";
import { effectiveValue, lotNumberIn, valuationLabel } from "@/components/agent-hub/LotCards";
import { chartSummary, drillPrompt, explainChartPrompt } from "@/components/agent-hub/PinnedBoard";
import { answerTitle, pinId } from "@/components/agent-hub/pins";
import { REPORT_TEMPLATES } from "@/components/agent-hub/reportTemplates";
import { pickProvider } from "@/components/agent-hub/useAgentChat";
import { speakable } from "@/components/agent-hub/voice";
import type { ChartSpec } from "@/components/assistant/ChartBlock";
import type { AgentUsageRow, Lot } from "@/types/api";
import { describe, expect, it } from "vitest";

const spec: ChartSpec = {
  type: "bar", title: "Average price by broker", subtitle: "Last 12 sales", unit: "Rs/kg", categoryAxis: "Broker",
  categories: ["ASC", "Forbes", "Bartleet"], series: [{ name: "Avg", values: [1200, 1100, null] }],
};
const lot = (over: Partial<Lot> = {}): Lot => ({ id: "l", lotNumber: "1204", valuation: { valuationFrom: 1100, valuationTo: 1300, valuationSingle: null }, ...over }) as unknown as Lot;

describe("charts", () => {
  it("describes a chart from its own figures, so explaining never depends on chat history", () => {
    const s = chartSummary(spec);
    expect(s).toContain("Average price by broker");
    expect(s).toContain("ASC: Avg=1200");
    expect(s).toContain("Bartleet: Avg=n/a");
    expect(explainChartPrompt(spec)).toContain("Use only these figures");
    expect(drillPrompt(spec, "Forbes")).toContain('"Forbes"');
  });

  it("turns a chart into a table, a snapshot, a preview dataset and a deck entry — all from its own numbers", () => {
    expect(specMarkdown(spec)).toBe("| Broker | Avg |\n| --- | --- |\n| ASC | 1,200 |\n| Forbes | 1,100 |\n| Bartleet | — |");
    const snap = specSnapshot(spec);
    expect(snap).toContain("## Average price by broker\nLast 12 sales");
    expect(snap).toContain("```asc-chart");
    expect(snap).toContain("Source: ASC Intelligence Hub");
    expect(specToPreview(spec)).toMatchObject({ title: spec.title, scope: "Last 12 sales", unit: "Rs/kg", categories: spec.categories });
    expect(specToDeckReport(spec)).toMatchObject({ visual: "bar", categoryAxis: "Broker" });
    expect(specToDeckReport({ ...spec, type: "line" }).visual).toBe("line");
    expect(specToDeckReport({ ...spec, type: "stacked_bar" }).visual).toBe("bar");
  });

  it("gives the same pin key to the same content, and titles an answer from its first line", () => {
    expect(pinId("chart", "x")).toBe(pinId("chart", "x"));
    expect(pinId("chart", "x")).not.toBe(pinId("answer", "x"));
    expect(answerTitle("## **Top** broker\nmore")).toBe("Top broker");
    expect(answerTitle("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
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
    expect(archiveGap(null, { year: 2026, saleNo: 39 })).toBeNull(); // unknown archive: say nothing rather than guess
  });
});

describe("lots", () => {
  it("finds the lot number in a question", () => {
    expect(lotNumberIn("What is the valuation of lot 1204?")).toBe("1204");
    expect(lotNumberIn("explain lot #77")).toBe("77");
    expect(lotNumberIn("Lot no. 5 please")).toBe("5");
    expect(lotNumberIn("Which garden had the top prices?")).toBeNull();
    expect(lotNumberIn("a lot of tea")).toBeNull();
  });

  it("values a lot as a range, a single value, the middle of a range, or nothing", () => {
    expect(valuationLabel(lot())).toBe("Rs 1,100 – 1,300");
    expect(valuationLabel(lot({ valuation: null }))).toBeNull();
    expect(effectiveValue(lot())).toBe(1200);
    expect(effectiveValue(lot({ valuation: { valuationSingle: 950, valuationFrom: null, valuationTo: null } as Lot["valuation"] }))).toBe(950);
    expect(effectiveValue(lot({ valuation: null }))).toBeNull();
  });
});

describe("report templates", () => {
  it("are plain builder choices, each different from the last", () => {
    expect(REPORT_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(REPORT_TEMPLATES.map((t) => JSON.stringify(t.state))).size).toBe(REPORT_TEMPLATES.length);
  });
});

describe("voice and providers", () => {
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

describe("usage", () => {
  const row = (over: Partial<AgentUsageRow> = {}): AgentUsageRow => ({ agent: "general", callCount: 42, failureCount: 1, promptTokens: 1000, completionTokens: 500, estimatedCostUsd: 0.314, ...over });

  it("formats calls, and cost only when the models were priced", () => {
    expect(usageLabel(row())).toBe("42 calls · $0.31");
    expect(usageLabel(row({ callCount: 1, estimatedCostUsd: null }))).toBe("1 call");
    expect(usageLabel(undefined)).toBe("No AI calls");
  });

  it("adds every agent's usage together; the cost stays unknown when nothing was priced", () => {
    const total = totalOf([row(), row({ agent: "reports", callCount: 2, estimatedCostUsd: null })])!;
    expect([total.callCount, total.estimatedCostUsd]).toEqual([44, 0.314]);
    expect(totalOf([row({ estimatedCostUsd: null })])!.estimatedCostUsd).toBeNull();
    expect(totalOf([])).toBeUndefined();
  });
});
