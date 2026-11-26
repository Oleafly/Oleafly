import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import type { SnippetLanguage } from "@oleafly/snippets";
import { beforeAll, describe, expect, it } from "vitest";
import { latexLanguage } from "../latex";
import { mathContextAt, mathContextInRange } from "../latex-lexical";
import { markdownLanguage } from "../markdown";
import { loadTypstParser, typstLanguage } from "../typst";
import { PARAGRAPH_SCAN_LIMIT, paragraphStart, snippetPlaceAt } from "./place";

beforeAll(async () => {
  await loadTypstParser();
});

const CARET = "‸";

function stateAt(marked: string, extensions: Extension[]): { state: EditorState; pos: number } {
  const pos = marked.indexOf(CARET);
  const doc = marked.replace(CARET, "");
  const state = EditorState.create({ doc, extensions });
  ensureSyntaxTree(state, state.doc.length, 5_000);
  return { state, pos };
}

function placeIn(marked: string, language: SnippetLanguage, extensions: Extension[]) {
  const { state, pos } = stateAt(marked, extensions);
  return snippetPlaceAt(state, pos, language);
}

const latex = (marked: string) => placeIn(marked, "latex", [latexLanguage()]);
const typst = (marked: string) => placeIn(marked, "typst", [typstLanguage()]);
const markdown = (marked: string) => placeIn(marked, "markdown", [markdownLanguage()]);

describe("snippetPlaceAt in LaTeX", () => {
  it.each([
    ["Some prose ‸", "text"],
    ["$x‸$", "inline-math"],
    ["\\(x‸\\)", "inline-math"],
    ["$$x‸$$", "display-math"],
    ["\\[x‸\\]", "display-math"],
    ["\\begin{align}x‸", "display-math"],
    ["$\\text{a‸}$", "text"],
    ["$\\mathrm{st‸}$", "text"],
    ["$\\operatorname*{ar‸}$", "text"],
    ["\\[ \\text{for $x‸$} \\]", "inline-math"],
    ["$x^{a‸}$", "inline-math"],
    ["$\\frac{a}{b‸}$", "inline-math"],
    ["$\\frac{a}[b]{c‸}$", "inline-math"],
    ["${a}{b‸}$", "inline-math"],
    ["$\\\\{b‸}$", "inline-math"],
    ["$]{b‸}$", "inline-math"],
    ["\\textbf{mk‸}", "text"],
  ])("%s is %s", (marked, place) => {
    expect(latex(marked)).toBe(place);
  });

  it.each([
    "\\label{eq:su‸}",
    "$\\label{eq:su‸}$",
    "\\texttt{mk‸}",
    "\\texttt{a \\textbf{mk‸}}",
    "\\cite{ke‸}",
    "\\citep[p.~3]{ke‸}",
    "\\parencite*{ke‸}",
    "\\href{https://oleafly.edu}{t‸}",
    "\\begin{ali‸",
    "% mk‸",
    "text % mk‸",
    "\\begin{verbatim}\nmk‸\n\\end{verbatim}",
    "\\verb+mk‸+",
  ])("%s never fires", (marked) => {
    expect(latex(marked)).toBeNull();
  });

  it("reads plain prose as text when inline math sits more than 2 KB back in the paragraph", () => {
    const prose = "word ".repeat(Math.ceil(3_000 / 5));
    const doc = `Intro.\n\nStart $a$ ${prose}`;
    const state = EditorState.create({ doc, extensions: [latexLanguage()] });
    expect(snippetPlaceAt(state, doc.length, "latex")).toBe("text");
  });

  it("would misread the prose as math with a fixed 2 KB window", () => {
    const tail = " prose";
    const filler = "b".repeat(2 * 1024 - "$a$".length - tail.length + 1);
    const doc = `$a$${filler}${tail}`;
    const state = EditorState.create({ doc, extensions: [latexLanguage()] });
    const pos = doc.length;
    expect(mathContextAt(state, pos).inMath).toBe(true);
    expect(mathContextInRange(state, 0, pos).inMath).toBe(false);
    expect(snippetPlaceAt(state, pos, "latex")).toBe("text");
  });

  it("starts the paragraph after the last blank line", () => {
    const doc = "$a\n\nprose";
    const state = EditorState.create({ doc, extensions: [latexLanguage()] });
    expect(snippetPlaceAt(state, doc.length, "latex")).toBe("text");
    expect(paragraphStart(state, doc.length)).toBe(4);
  });

  it("treats a short whitespace line as blank but not a long one", () => {
    const short = EditorState.create({ doc: "a\n  \t\nb" });
    expect(paragraphStart(short, short.doc.length)).toBe(6);
    const long = EditorState.create({ doc: `a\n${" ".repeat(300)}\nb` });
    expect(paragraphStart(long, long.doc.length)).toBe(0);
  });

  it("starts at the caret line when the caret sits on a blank line", () => {
    const state = EditorState.create({ doc: "a\n\n" });
    expect(paragraphStart(state, 2)).toBe(2);
  });

  it("gives up on a paragraph with no blank line in 16 KB", () => {
    const line = "x ".repeat(40);
    const doc = Array.from({ length: Math.ceil((20 * 1024) / line.length) }, () => line).join("\n");
    const state = EditorState.create({ doc, extensions: [latexLanguage()] });
    expect(snippetPlaceAt(state, doc.length, "latex")).toBeNull();
    expect(paragraphStart(state, PARAGRAPH_SCAN_LIMIT)).toBe(0);
  });

  it("gives up on a single line longer than 16 KB", () => {
    const doc = "x".repeat(PARAGRAPH_SCAN_LIMIT + 10);
    const state = EditorState.create({ doc, extensions: [latexLanguage()] });
    expect(snippetPlaceAt(state, doc.length, "latex")).toBeNull();
  });

  it("caches the answer per state and clamps the position", () => {
    const { state, pos } = stateAt("$x‸$", [latexLanguage()]);
    expect(snippetPlaceAt(state, pos, "latex")).toBe("inline-math");
    expect(snippetPlaceAt(state, pos, "latex")).toBe("inline-math");
    const comment = EditorState.create({ doc: "% c", extensions: [latexLanguage()] });
    expect(snippetPlaceAt(comment, 99, "latex")).toBeNull();
    expect(snippetPlaceAt(comment, 99, "latex")).toBeNull();
    expect(snippetPlaceAt(comment, 99, "notes")).toBe("text");
  });
});

describe("snippetPlaceAt in Typst", () => {
  it.each([
    ["Prose ‸", "text"],
    ["$ x‸ $", "display-math"],
    ["$x‸$", "inline-math"],
    ["#f(1, a‸)", "code"],
    ["#{ let a = 1‸ }", "code"],
  ])("%s is %s", (marked, place) => {
    expect(typst(marked)).toBe(place);
  });

  it.each(["// mk‸", "/* mk‸ */", '#let a = "mk‸"', "`mk‸`"])("%s never fires", (marked) => {
    expect(typst(marked)).toBeNull();
  });

  it("falls back to a scan without a parsed tree", () => {
    expect(placeIn("$ x‸ $", "typst", [])).toBe("display-math");
    expect(placeIn("$x‸$", "typst", [])).toBe("inline-math");
    expect(placeIn("\\$ $x‸", "typst", [])).toBe("inline-math");
    expect(placeIn(`$ ${"x".repeat(PARAGRAPH_SCAN_LIMIT + 10)}‸`, "typst", [])).toBe("inline-math");
  });
});

describe("snippetPlaceAt in Markdown, BibTeX and Notes", () => {
  it.each([
    ["Prose ‸", "text"],
    ["```\ncode‸\n```", "code"],
    ["Use `co‸de` here", "code"],
    ["Then $x‸$ here", "inline-math"],
    ["$$x‸$$", "display-math"],
  ])("%s is %s in Markdown", (marked, place) => {
    expect(markdown(marked)).toBe(place);
  });

  it("is always text in BibTeX and Notes", () => {
    expect(placeIn("@article{key, title = {‸}}", "bibtex", [])).toBe("text");
    expect(placeIn("$x‸$", "notes", [])).toBe("text");
  });
});
