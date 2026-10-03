import { describe, expect, it } from "vitest";
import { parseMarkdownTable } from "./tableExports";

describe("parseMarkdownTable", () => {
  it("finds the first table and strips bold markers", () => {
    const t = parseMarkdownTable("Here you go:\n\n| Factory | Qty (kg) |\n|---|---:|\n| **Abbotsleigh** | 1,500 |\n| Other | 200 |\n\nDone.");
    expect(t).toEqual({ header: ["Factory", "Qty (kg)"], rows: [["Abbotsleigh", "1,500"], ["Other", "200"]] });
  });
  it("returns null when there is no table", () => {
    expect(parseMarkdownTable("just text | with a pipe")).toBeNull();
  });
});
