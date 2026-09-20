import { HUB_AGENTS, SPECIALISTS, agentHref, askHref, isAgentKey } from "@/components/agent-hub/agents";
import { getUiStrings, type UiLang } from "@/lib/i18n";
import { describe, expect, it } from "vitest";

describe("hub agents", () => {
  it("has exactly the four backend agent keys", () => {
    expect(HUB_AGENTS.map((a) => a.key).sort()).toEqual(["analytics", "auction", "general", "reports"]);
    expect(HUB_AGENTS.map((a) => a.number).sort()).toEqual([1, 2, 3, 4]);
  });

  it("makes General the ask box (agent 01) and the other three the specialists", () => {
    expect(HUB_AGENTS.find((a) => a.key === "general")).toMatchObject({ number: 1 });
    expect(SPECIALISTS.map((a) => a.key).sort()).toEqual(["analytics", "auction", "reports"]);
  });

  it("recognises only real agent keys and links to /assistant/<key>", () => {
    expect(isAgentKey("general")).toBe(true);
    expect(isAgentKey("classic")).toBe(false);
    expect(isAgentKey("__proto__")).toBe(false);
    expect(agentHref("analytics")).toBe("/assistant/analytics");
  });

  it("sends a hub question to the General assistant, sent immediately, with the text safely encoded", () => {
    expect(askHref("top prices")).toBe("/assistant/classic?agent=general&send=1&q=top%20prices");
    expect(askHref("a&b=c #x?")).toBe("/assistant/classic?agent=general&send=1&q=a%26b%3Dc%20%23x%3F");
  });
});

describe("hub strings", () => {
  const langs: UiLang[] = ["en", "si", "ta"];

  it.each(langs)("has every agent string in %s", (lang) => {
    const t = getUiStrings(lang);
    for (const agent of HUB_AGENTS) {
      expect(t[agent.nameKey].trim()).not.toBe("");
      expect(t[agent.purposeKey].trim()).not.toBe("");
      expect(t[agent.capsKey].trim()).not.toBe("");
    }
    for (const k of ["hubAskTitle", "hubAskHint", "hubAskPlaceholder", "hubAskLabel", "hubAskSend", "hubSpecialists", "hubPrompt1", "hubPrompt2", "hubPrompt3", "hubStartHere", "hubSub"] as const) {
      expect(t[k].trim(), k).not.toBe("");
    }
    expect(t.hubAgentLabel(1)).toContain("01");
    expect(t.hubOpenAgent("X")).toContain("X");
    expect(t.hubOpening("X")).toContain("X");
  });

  it("actually translates the hub into Sinhala and Tamil rather than repeating English", () => {
    const en = getUiStrings("en");
    for (const lang of ["si", "ta"] as const) {
      const t = getUiStrings(lang);
      expect(t.hubAskTitle).not.toBe(en.hubAskTitle);
      expect(t.hubSpecialists).not.toBe(en.hubSpecialists);
      expect(t.hubPrompt1).not.toBe(en.hubPrompt1);
      for (const agent of HUB_AGENTS) expect(t[agent.purposeKey]).not.toBe(en[agent.purposeKey]);
    }
  });
});
