import { describe, expect, it } from "vitest";
import {
  collectLatexOutlineMacros,
  createLatexOutlineMacroCollector,
  createLatexWrapperSectionCollector,
  renderLatexOutlineTitle,
} from "./outline-title";

describe("renderLatexOutlineTitle", () => {
  it("decodes accent macros into letters", () => {
    expect(renderLatexOutlineTitle(String.raw`\'Uvod do \v{C}e\v{s}tiny`)).toBe("Úvod do Češtiny");
    expect(renderLatexOutlineTitle(String.raw`Stra\ss e und \"Uberblick`)).toBe("Straße und Überblick");
  });

  it("expands project macros spelled with Unicode letters", () => {
    const macros = collectLatexOutlineMacros({
      "main.tex": String.raw`\newcommand{\výsledek}{Výsledky}\def\αβ{Alfa}`,
    });
    expect(renderLatexOutlineTitle(String.raw`\výsledek a \αβ`, macros)).toBe("Výsledky a Alfa");
  });

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

  it("drops colour, case and font switch commands and plain grouping braces", () => {
    expect(renderLatexOutlineTitle(String.raw`{\color{oiB}Preface}`)).toBe("Preface");
    expect(renderLatexOutlineTitle(String.raw`{\color[rgb]{0,0,1}Blue} title`)).toBe("Blue title");
    expect(renderLatexOutlineTitle(String.raw`\textcolor{red}{Warm} up`)).toBe("Warm up");
    expect(renderLatexOutlineTitle(String.raw`\textcolor[HTML]{FF0000}{\textbf{Hot}}`)).toBe("Hot");
    expect(renderLatexOutlineTitle(String.raw`\colorbox{yellow}{Boxed}`)).toBe("Boxed");
    expect(renderLatexOutlineTitle(String.raw`\MakeUppercase{Data} sets`)).toBe("Data sets");
    expect(renderLatexOutlineTitle(String.raw`\textsc{Small caps} and \underline{lines}`)).toBe(
      "Small caps and lines",
    );
    expect(renderLatexOutlineTitle(String.raw`{\bfseries\large Results}`)).toBe("Results");
    expect(renderLatexOutlineTitle(String.raw`\Large Big \normalsize text`)).toBe("Big text");
    expect(renderLatexOutlineTitle(String.raw`Sets \{1, 2\}`)).toBe("Sets {1, 2}");
    expect(renderLatexOutlineTitle(String.raw`\unknown{kept}`)).toBe(String.raw`\unknown{kept}`);
    expect(renderLatexOutlineTitle(String.raw`\unknown[opt]{kept}`)).toBe(String.raw`\unknown[opt]{kept}`);
  });

  it("shows inline math as plain text", () => {
    expect(renderLatexOutlineTitle(String.raw`Analysis of variance and the $\pmb{F}$-test`)).toBe(
      "Analysis of variance and the F-test",
    );
    expect(renderLatexOutlineTitle(String.raw`adjusted $\boldsymbol{R^2}$`)).toBe("adjusted R^2");
    expect(renderLatexOutlineTitle(String.raw`The \(\bm{t}\) table costs \$5`)).toBe("The t table costs $5");
  });

  it("names the heading a \\nameref points at", () => {
    const labels = new Map([["ch_intro", "Introduction to \\textit{data}"]]);
    expect(renderLatexOutlineTitle(String.raw`\nameref{ch_intro}`, new Map(), labels)).toBe("Introduction to data");
    expect(renderLatexOutlineTitle(String.raw`See \Nameref*{ch_intro}`, new Map(), labels)).toBe(
      "See Introduction to data",
    );
    expect(renderLatexOutlineTitle(String.raw`\nameref{missing}`, new Map(), labels)).toBe("missing");
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

describe("createLatexOutlineMacroCollector", () => {
  it("gives the same macros as one full collection and follows edits and removals", () => {
    const collect = createLatexOutlineMacroCollector();
    const first = {
      "defs.sty": "\\newcommand{\\proj}{One}",
      "main.tex": "\\def\\proj{Two}\n\\newcommand{\\team}{Team}",
    };
    expect([...collect(first)]).toEqual([...collectLatexOutlineMacros(first)]);
    expect(collect(first).get("proj")).toBe("Two");

    const edited = { ...first, "main.tex": "\\newcommand{\\team}{Crew}" };
    const afterEdit = collect(edited);
    expect(afterEdit.get("proj")).toBe("One");
    expect(afterEdit.get("team")).toBe("Crew");

    const afterRemoval = collect({ "main.tex": edited["main.tex"] });
    expect(afterRemoval.has("proj")).toBe(false);
    expect(afterRemoval.get("team")).toBe("Crew");
  });
});

describe("createLatexWrapperSectionCollector", () => {
  it("finds wrapper headings across files and follows edits to the definitions", () => {
    const collect = createLatexWrapperSectionCollector();
    const style = String.raw`\newenvironment{chapterpage}[1]{\chapter{#1}}{}`;
    const chapter = String.raw`\begin{chapterpage}{Introduction to data}
% \begin{chapterpage}{Commented out}
\end{chapterpage}`;
    const first = collect({ "style.sty": style, "ch.tex": chapter, "notes.md": chapter });
    expect([...first.keys()]).toEqual(["ch.tex"]);
    expect(first.get("ch.tex")?.map((section) => [section.level, section.title])).toEqual([
      [1, "Introduction to data"],
    ]);
    expect(collect({ "style.sty": style, "ch.tex": chapter }).get("ch.tex")).toBe(first.get("ch.tex"));
    const none = collect({ "style.sty": String.raw`\newenvironment{chapterpage}[1]{}{}`, "ch.tex": chapter });
    expect(none.size).toBe(0);
  });
});
