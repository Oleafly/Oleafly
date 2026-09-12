import { describe, expect, it } from "vitest";
import { collectLatexOutlineMacros, renderLatexOutlineTitle } from "./outline-title";

describe("renderLatexOutlineTitle", () => {
  it("strips every simple text command it knows", () => {
    const names = [
      "emph",
      "footnotesize",
      "Huge",
      "huge",
      "LARGE",
      "Large",
      "large",
      "mathbf",
      "mathit",
      "mathrm",
      "mathsf",
      "scriptsize",
      "small",
      "textbf",
      "textit",
      "textnormal",
      "textrm",
      "textsf",
      "texttt",
      "tiny",
    ];
    for (const name of names) {
      expect(renderLatexOutlineTitle(`A \\${name}{kept} B`)).toBe("A kept B");
    }
    expect(renderLatexOutlineTitle("\\textbf {spaced}")).toBe("spaced");
    expect(renderLatexOutlineTitle("\\textbf{\\emph{nested}}")).toBe("nested");
    expect(renderLatexOutlineTitle("\\textbf{}")).toBe("");
    expect(renderLatexOutlineTitle("\\unknown{kept}")).toBe("\\unknown{kept}");
  });

  it("unwraps an old style font switch group", () => {
    expect(renderLatexOutlineTitle("{\\bf bold} tail")).toBe("bold tail");
    expect(renderLatexOutlineTitle("{\\it   spaced}")).toBe("spaced");
    expect(renderLatexOutlineTitle("{\\tt a b }")).toBe("a b");
    expect(renderLatexOutlineTitle("{\\rm }")).toBe("");
    expect(renderLatexOutlineTitle("{\\sf x}")).toBe("x");
    expect(renderLatexOutlineTitle("{\\bfnospace}")).toBe("{\\bfnospace}");
    expect(renderLatexOutlineTitle("{\\bf   ")).toBe("{\\bf");
  });

  it("turns a non breaking space into a space", () => {
    expect(renderLatexOutlineTitle("a~b~~c")).toBe("a b c");
  });

  it("keeps the rest of the replacement chain intact", () => {
    expect(renderLatexOutlineTitle("\\LaTeX{} and \\TeX")).toBe("LaTeX and TeX");
    expect(renderLatexOutlineTitle("5 \\pm 1 \\times 2 \\to 3")).toBe("5 ± 1 × 2 → 3");
    expect(renderLatexOutlineTitle("100\\% \\& more")).toBe("100% & more");
    expect(renderLatexOutlineTitle("``quoted''")).toBe('"quoted"');
  });
});

describe("collectLatexOutlineMacros", () => {
  it("reads every spelling of a zero argument definition", () => {
    const macros = collectLatexOutlineMacros({
      "main.tex": [
        "\\newcommand{\\alpha}{A}",
        "\\newcommand\\beta{B}",
        "\\newcommand*{\\gamma}{C}",
        "\\renewcommand  {  \\delta  }  [0]  {D}",
        "\\providecommand{\\eps}[0]{E}",
        "\\newcommand{\\witharg}[1]{X#1}",
        "\\def\\zeta{Z}",
        "\\def  \\eta  {H}",
      ].join("\n"),
    });

    expect(macros.get("alpha")).toBe("A");
    expect(macros.get("beta")).toBe("B");
    expect(macros.get("gamma")).toBe("C");
    expect(macros.get("delta")).toBe("D");
    expect(macros.get("eps")).toBe("E");
    expect(macros.has("witharg")).toBe(false);
    expect(macros.get("zeta")).toBe("Z");
    expect(macros.get("eta")).toBe("H");
  });

  it("ignores commented out and non LaTeX files", () => {
    const macros = collectLatexOutlineMacros({
      "notes.md": "\\newcommand{\\skipped}{S}",
      "main.tex": "% \\newcommand{\\hidden}{H}\n\\newcommand{\\kept}{K}",
    });
    expect(macros.has("skipped")).toBe(false);
    expect(macros.has("hidden")).toBe(false);
    expect(macros.get("kept")).toBe("K");
  });

  it("expands a collected macro inside a title", () => {
    const macros = collectLatexOutlineMacros({ "main.tex": "\\newcommand{\\proj}{Oleafly}" });
    expect(renderLatexOutlineTitle("\\proj{} results", macros)).toBe("Oleafly results");
  });
});
