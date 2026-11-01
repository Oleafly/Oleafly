import { describe, expect, it } from "vitest";
import { tableThemeSpec } from "./theme";

describe("the Visual table theme", () => {
  it("sizes its toolbar, dialog and hint text in rem or em, so App font size scales it", () => {
    const sizes = Object.entries(tableThemeSpec as Record<string, Record<string, unknown>>).flatMap(([selector, rules]) =>
      "fontSize" in rules ? [[selector, String(rules.fontSize)]] : [],
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const [selector, size] of sizes) expect(size, selector).toMatch(/^(?:\d*\.?\d+r?em|inherit)$/u);
  });
});
