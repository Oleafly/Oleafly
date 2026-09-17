import { describe, expect, it } from "vitest";
import { LATEX_BASE_COLOR_NAMES, LATEX_DVIPS_COLOR_NAMES, latexColorToCss } from "./latex-color";

describe("latexColorToCss", () => {
  it("maps the base colour names", () => {
    expect(latexColorToCss("red")).toBe("#ff0000");
    expect(latexColorToCss("teal")).toBe("#008080");
    expect(latexColorToCss("lightgray")).toBe("#bfbfbf");
    expect(latexColorToCss("white")).toBe("#ffffff");
  });

  it("maps dvipsnames", () => {
    expect(latexColorToCss("RoyalBlue")).toBe("#0071bc");
    expect(latexColorToCss("Apricot")).toBe("#fbb982");
    expect(latexColorToCss("YellowOrange")).toBe("#faa21a");
  });

  it("declares 19 base names and 68 distinct dvipsnames", () => {
    expect(LATEX_BASE_COLOR_NAMES).toHaveLength(19);
    expect(LATEX_DVIPS_COLOR_NAMES).toHaveLength(68);
    expect(new Set(LATEX_DVIPS_COLOR_NAMES).size).toBe(68);
    for (const name of [...LATEX_BASE_COLOR_NAMES, ...LATEX_DVIPS_COLOR_NAMES]) {
      expect(latexColorToCss(name)).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });

  it("parses model specifications", () => {
    expect(latexColorToCss("[HTML]{FF8800}")).toBe("#ff8800");
    expect(latexColorToCss("[rgb]{1,0.5,0}")).toBe("#ff8000");
    expect(latexColorToCss("[RGB]{12,34,56}")).toBe("#0c2238");
    expect(latexColorToCss("[gray]{0.5}")).toBe("#808080");
    expect(latexColorToCss(" [HTML] {00ff00} ")).toBe("#00ff00");
  });

  it("computes xcolor mixes", () => {
    expect(latexColorToCss("red!30")).toBe("#ffb3b3");
    expect(latexColorToCss("blue!40!white")).toBe("#9999ff");
    expect(latexColorToCss("red!50!blue")).toBe("#800080");
    expect(latexColorToCss("red!50!blue!50")).toBe("#bf80bf");
    expect(latexColorToCss("red!150")).toBe("#ff0000");
  });

  it("returns null for unknown or malformed specifications", () => {
    for (const spec of [
      "",
      "nope",
      "red!",
      "red!x",
      "-red",
      "[HTML]{GGGGGG}",
      "[cmyk]{0,0,0,1}",
      "[rgb]{1,0}",
      "[rgb]{a,b,c}",
      "red!30!nope",
    ]) {
      expect(latexColorToCss(spec), spec).toBeNull();
    }
  });
});
