import { DEFAULT_STATE, toRequest } from "@/components/agent-hub/reportBuilder";
import { SAMPLE_LINE, applyVoiceCommand, parseVoiceCommand } from "@/components/agent-hub/voiceCommand";
import { describe, expect, it } from "vitest";

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
