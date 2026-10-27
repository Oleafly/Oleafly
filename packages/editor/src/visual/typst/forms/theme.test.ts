import { describe, expect, it } from "vitest";
import { typstFormsThemeSpec } from "./theme";

describe("the forms theme", () => {
  it("never draws an outline or a ring, and only the popover casts a drop shadow", () => {
    for (const [selector, rules] of Object.entries(typstFormsThemeSpec)) {
      const declarations = rules as Record<string, string>;
      if ("outline" in declarations) expect(declarations.outline, selector).toBe("none");
      const shadows = Object.keys(declarations).filter((property) => /shadow|^ring/iu.test(property));
      expect(shadows, selector).toEqual(selector === ".ofl-visual-form-popover" ? ["boxShadow"] : []);
    }
    // A ring is a shadow with no offset and no blur; this one is offset and blurred below the panel.
    const [x, y, blur] = typstFormsThemeSpec[".ofl-visual-form-popover"].boxShadow.split(" ").map((part) => Number.parseFloat(part));
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(0);
    expect(blur).toBeGreaterThan(0);
  });

  it("turns the browser's focus outline off on every control that can take focus", () => {
    for (const selector of [".ofl-visual-form-input", ".ofl-visual-form-switch", ".ofl-visual-form-action", ".ofl-visual-form-chip-button"]) {
      expect((typstFormsThemeSpec as Record<string, Record<string, string>>)[selector]?.outline, selector).toBe("none");
    }
  });
});
