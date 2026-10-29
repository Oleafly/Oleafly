import { describe, expect, it } from "vitest";
import { typstFormsThemeSpec } from "./theme";

type Spec = Record<string, unknown>;

// Every selector's declarations, with the rules inside an at-rule such as @container included.
function ruleEntries(spec: Spec): [string, Spec][] {
  return Object.entries(spec).flatMap(([selector, rules]) =>
    selector.startsWith("@") ? ruleEntries(rules as Spec) : [[selector, rules as Spec]],
  );
}

describe("the forms theme", () => {
  it("never draws an outline or a ring, and only the popover casts a drop shadow", () => {
    for (const [selector, rules] of ruleEntries(typstFormsThemeSpec)) {
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
      expect((typstFormsThemeSpec as unknown as Record<string, Record<string, string>>)[selector]?.outline, selector).toBe("none");
    }
  });

  it("takes its colours from the editor's theme, which can differ from the app's light or dark mode", () => {
    for (const [selector, rules] of ruleEntries(typstFormsThemeSpec)) {
      for (const value of Object.values(rules)) {
        expect(String(value), selector).not.toMatch(/var\(--(?:foreground|background)\)/u);
      }
    }
  });

  it("stacks each label above its control in a narrow card", () => {
    const narrow = (typstFormsThemeSpec as Spec)["@container (max-width: 30em)"] as Spec;
    expect((narrow[".ofl-visual-form-label"] as Spec).gridColumn).toBe("1 / -1");
    expect(typstFormsThemeSpec[".ofl-visual-form-card"].containerType).toBe("inline-size");
  });
});
