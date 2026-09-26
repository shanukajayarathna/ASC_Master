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

  it("understands off-grade and main-grade, and the share of a broker's own volume", () => {
    expect(parseVoiceCommand("compare off grade quantity by broker").patch).toMatchObject({ gradeTypes: ["Off Grade"], group: "broker" });
    expect(parseVoiceCommand("main grade proceeds by broker").patch.gradeTypes).toEqual(["Main Grade"]);
    const share = parseVoiceCommand("what share of each broker's own volume is off grade");
    expect(share.patch).toMatchObject({ metric: "share_of_own_volume_pct", gradeTypes: ["Off Grade"] });
    expect(share.understood).toContain("Measure: share of own volume");
    // the measure only makes sense per broker, so applying it groups by broker
    expect(applyVoiceCommand({ ...DEFAULT_STATE, group: "grade" }, share).group).toBe("broker");
    // a new subject clears an old grade-type filter unless one was said
    expect(applyVoiceCommand({ ...DEFAULT_STATE, gradeTypes: ["Off Grade"] }, parseVoiceCommand("compare grades by proceeds")).gradeTypes).toEqual([]);
    expect(toRequest({ ...DEFAULT_STATE, gradeTypes: ["Off Grade"] }).gradeTypes).toEqual(["Off Grade"]);
  });

  it("sends a chosen scope as the period only when the period is 'Chosen scope'", () => {
    const range = { fromYear: 2025, fromSale: 40, toYear: 2026, toSale: 5 };
    expect(toRequest({ ...DEFAULT_STATE, period: "scope", range })).toMatchObject({ fromYear: 2025, fromSale: 40, toYear: 2026, toSale: 5 });
    expect(toRequest({ ...DEFAULT_STATE, period: "scope", range }).lastNSales).toBeUndefined();
    expect(toRequest({ ...DEFAULT_STATE, period: "12", range }).fromYear).toBeUndefined();
    expect(toRequest({ ...DEFAULT_STATE, period: "scope", range: null }).fromYear).toBeUndefined();
  });
});

describe("named periods, elevations and more breakdowns", () => {
  const now = new Date("2026-09-27");

  it("reads a named sale with its year, in any of the usual wordings", () => {
    for (const said of ["best selling grade for sale 37 of 2026", "grades sale 37/2026", "sale 37, 2026, quantity sold"]) {
      const c = parseVoiceCommand(said, now);
      expect(c.patch).toMatchObject({ period: "scope", range: { fromYear: 2026, fromSale: 37, toYear: 2026, toSale: 37 } });
      expect(c.understood).toContain("Period: sale 37/2026");
    }
  });

  it("does not guess the year of a bare sale number, and says so", () => {
    const c = parseVoiceCommand("average price for sale 32", now);
    expect(c.patch.range).toBeUndefined();
    expect(c.notes[0]).toContain("needs a year");
  });

  it("reads a year, and 'last year' from today's date", () => {
    expect(parseVoiceCommand("average price by broker in 2025", now).patch.range).toEqual({ fromYear: 2025, fromSale: null, toYear: 2025, toSale: null });
    expect(parseVoiceCommand("quantity by grade last year", now).patch.range).toEqual({ fromYear: 2025, fromSale: null, toYear: 2025, toSale: null });
  });

  it("reads an elevation, as one of the archive's names or a whole grown class", () => {
    expect(parseVoiceCommand("average price for uva high", now).patch.elevations).toEqual(["UVA HIGH"]);
    expect(parseVoiceCommand("compare brokers for high grown tea", now).patch.elevations).toEqual(["UVA HIGH", "WESTERN HIGH"]);
    expect(parseVoiceCommand("low grown volume", now).patch.elevations).toEqual(["LOW"]);
    expect(toRequest({ ...DEFAULT_STATE, elevations: ["LOW"] }).elevations).toEqual(["LOW"]);
    expect(toRequest(DEFAULT_STATE).elevations).toBeUndefined();
  });

  it("groups by buyer or mark when asked", () => {
    expect(parseVoiceCommand("top buyers by quantity", now).patch.group).toBe("buyer");
    expect(parseVoiceCommand("compare marks by average price", now).patch.group).toBe("mark");
  });

  it("a new subject clears an old elevation filter unless one was spoken", () => {
    const withElevation = { ...DEFAULT_STATE, elevations: ["LOW"] };
    expect(applyVoiceCommand(withElevation, parseVoiceCommand("compare grades by proceeds", now)).elevations).toEqual([]);
    expect(applyVoiceCommand(withElevation, parseVoiceCommand("last 4 sales", now)).elevations).toEqual(["LOW"]);
  });
});
