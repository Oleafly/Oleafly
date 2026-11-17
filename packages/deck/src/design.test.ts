import { describe, expect, it } from "vitest";
import { cssVarsToString, defaultDesign, designToCssVars } from "./design";

describe("design tokens", () => {
  it("turns a design into CSS variables with pixel sizes", () => {
    expect(
      designToCssVars({
        palette: { bg: "#000", text: "#fff", accent: "#f00" },
        fonts: { display: "Serif", body: "Sans" },
        typeScale: { hero: 120, body: 30 },
        radius: 4,
      }),
    ).toEqual({
      "--osd-bg": "#000",
      "--osd-text": "#fff",
      "--osd-accent": "#f00",
      "--osd-font-display": "Serif",
      "--osd-font-body": "Sans",
      "--osd-size-hero": "120px",
      "--osd-size-body": "30px",
      "--osd-radius": "4px",
    });
  });

  it("writes variables as indented declarations, one per line", () => {
    expect(cssVarsToString({ "--osd-bg": "#000", "--osd-radius": "4px" })).toBe("  --osd-bg: #000;\n  --osd-radius: 4px;");
  });

  it("ships a default design that converts cleanly", () => {
    const vars = designToCssVars(defaultDesign);
    expect(vars["--osd-bg"]).toBe("#f7f5f0");
    expect(vars["--osd-size-body"]).toBe("36px");
    expect(cssVarsToString(vars).split("\n")).toHaveLength(8);
  });
});
