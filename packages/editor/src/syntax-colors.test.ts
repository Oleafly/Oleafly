import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { beforeAll, describe, expect, it } from "vitest";
import {
  EDITOR_COLOR_IDS,
  SYNTAX_ROLES,
  editorColor,
  editorColorDeclarations,
  editorColorVariable,
  resolvedEditorColor,
  themeColorValue,
} from "./color-roles";
import { languageForPath } from "./languages";
import { editorHighlightStyle, syntaxRoleHighlighter } from "./syntax-colors";
import { loadTypstParser } from "./typst";

beforeAll(async () => {
  await loadTypstParser();
});

function roles(path: string, text: string): (token: string, occurrence?: number) => string[] {
  const language = languageForPath(path);
  if (!language) throw new Error(`No language for ${path}`);
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, state.doc.length, 1_000);
  if (!tree) throw new Error(`Syntax tree did not finish parsing ${path}`);
  const spans: { from: number; to: number; classes: string }[] = [];
  highlightTree(tree, syntaxRoleHighlighter, (from, to, classes) => spans.push({ from, to, classes }));
  return (token, occurrence = 0) => {
    let from = -1;
    for (let seen = 0; seen <= occurrence; seen += 1) from = text.indexOf(token, from + 1);
    if (from < 0) throw new Error(`${token} is not in the sample`);
    const found = new Set<string>();
    for (let position = from; position < from + token.length; position += 1) {
      const span = spans.find((candidate) => candidate.from <= position && position < candidate.to);
      for (const name of span?.classes.split(" ") ?? []) if (name) found.add(name);
    }
    return [...found];
  };
}

describe("syntax roles", () => {
  it("gives LaTeX commands, structure, references, environments and math their own roles", () => {
    const at = roles(
      "paper.tex",
      [
        String.raw`\documentclass[12pt]{article}`,
        String.raw`\usepackage{amsmath}`,
        "% note",
        String.raw`\section{Results}`,
        String.raw`Energy is \textbf{conserved} \cite{noether}, see \ref{eq:energy}.`,
        String.raw`\begin{equation}`,
        String.raw`  E = mc^2 \label{eq:energy}`,
        String.raw`\end{equation}`,
        String.raw`\href{https://oleafly.com}{Oleafly} a~b $x$`,
      ].join("\n"),
    );
    expect(at(String.raw`\documentclass`)).toEqual(["structure"]);
    expect(at(String.raw`\usepackage`)).toEqual(["structure"]);
    expect(at("amsmath")).toEqual(["structure"]);
    expect(at("article")).toEqual(["structure"]);
    expect(at("12pt")).toEqual(["value"]);
    expect(at("% note")).toEqual(["comment"]);
    expect(at(String.raw`\section`)).toEqual(["heading"]);
    expect(at("Results")).toEqual(["heading"]);
    expect(at(String.raw`\textbf`)).toEqual(["formatting"]);
    expect(at(String.raw`\cite`)).toEqual(["reference"]);
    expect(at("noether")).toEqual(["reference"]);
    expect(at(String.raw`\ref`)).toEqual(["reference"]);
    expect(at(String.raw`\begin`)).toEqual(["environment"]);
    expect(at("equation")).toEqual(["environment"]);
    expect(at(String.raw`\label`)).toEqual(["reference"]);
    expect(at("{", 1)).toEqual(["symbol"]);
    expect(at("~")).toEqual(["symbol"]);
    expect(at(String.raw`\href`)).toEqual(["command"]);
    expect(at("Oleafly")).toContain("link");
    expect(at("$x$")).toEqual(["math"]);
  });

  it("follows LaTeX arguments, math environments and escapes in source mode", () => {
    const at = roles(
      "paper.tex",
      [
        String.raw`\section*{Energy $E$ in 2024}`,
        String.raw`\begin{align*}`,
        String.raw`  a &= \frac{b}{c} \label{eq:sum} \\`,
        String.raw`\end{align*}`,
        String.raw`Cost 100\% of~it and \citep[p.~5]{doe}.`,
      ].join("\n"),
    );
    expect(at(String.raw`\section`)).toEqual(["heading"]);
    expect(at("*")).toEqual(["heading"]);
    expect(at("Energy")).toEqual(["heading"]);
    expect(at("$E$")).toEqual(["math"]);
    expect(at("2024")).toEqual(["heading"]);
    expect(at("align*")).toEqual(["environment"]);
    expect(at(String.raw`\frac`)).toEqual(["math"]);
    expect(at("{b}")).toEqual(["math"]);
    expect(at(String.raw`\label`)).toEqual(["reference"]);
    expect(at("eq:sum")).toEqual(["reference"]);
    expect(at(String.raw`\end`)).toEqual(["environment"]);
    expect(at("Cost")).toEqual([]);
    expect(at(String.raw`\%`)).toEqual(["symbol"]);
    expect(at("~", 0)).toEqual(["symbol"]);
    expect(at("it")).toEqual([]);
    expect(at(String.raw`\citep`)).toEqual(["reference"]);
    expect(at("doe")).toEqual(["reference"]);
  });

  it("maps Typst code and markup onto the same roles", () => {
    const at = roles(
      "paper.typ",
      [
        `#import "@preview/cetz:0.3.2": canvas`,
        `#set page(margin: 2cm)`,
        `// note`,
        `= Results`,
        `Energy is *conserved* @noether, see <eq>.`,
        `$ E = m c^2 $`,
        `#let width = 12pt`,
      ].join("\n"),
    );
    expect(at("import")).toEqual(["structure"]);
    expect(at("set")).toEqual(["command"]);
    expect(at("page")).toEqual(["command"]);
    expect(at("margin")).toEqual(["name"]);
    expect(at("2cm")).toEqual(["value"]);
    expect(at("// note")).toEqual(["comment"]);
    expect(at("Results")).toEqual(["heading"]);
    expect(at("*")).toEqual(["formatting"]);
    expect(at("@noether")).toEqual(["reference"]);
    expect(at("<eq>")).toEqual(["reference"]);
    expect(at("E = m c^2")).toContain("math");
    expect(at("let")).toEqual(["structure"]);
    expect(at("(")).toEqual(["symbol"]);
  });

  it("maps Markdown headings, emphasis, Pandoc citations, math and links onto the same roles", () => {
    const at = roles(
      "notes.md",
      [
        "# Results",
        "Energy is **conserved** [see @noether, p. 4; @doe:2020] and write to me@example.org.",
        "Bare @smith2004 and ~~struck~~ and [a link](https://example.org).",
        "$E = mc^2$",
        "[Oleafly](https://oleafly.com)",
        "<!-- note -->",
      ].join("\n"),
    );
    expect(at("Results")).toEqual(["heading"]);
    expect(at("**")).toEqual(["formatting"]);
    expect(at("@noether")).toEqual(["reference"]);
    expect(at("@doe:2020")).toEqual(["reference"]);
    expect(at("@example")).not.toContain("reference");
    expect(at("see")).toEqual([]);
    expect(at("@smith2004")).toEqual(["reference"]);
    expect(at("~~")).toEqual(["formatting"]);
    expect(at("a link")).toEqual(["link"]);
    expect(at("E = mc^2")).toEqual(["math"]);
    expect(at("$E")).toEqual(["math"]);
    expect(at("https://oleafly.com")).toContain("link");
    expect(at("<!-- note -->")).toEqual(["comment"]);
  });
});

describe("editor color variables", () => {
  it("reads a user color first, then the theme's role color, then its palette", () => {
    expect(resolvedEditorColor("heading")).toBe(
      "var(--cm-user-heading, var(--cm-theme-heading, var(--cm-meta)))",
    );
    expect(resolvedEditorColor("lineNumbers")).toBe(
      "var(--cm-user-line-numbers, var(--cm-gutter-fg, var(--muted-foreground)))",
    );
    expect(themeColorValue("background")).toBe("var(--cm-editor-bg, var(--background))");
    expect(editorColor("math")).toBe("var(--cm-syntax-math)");
    expect(editorColor("selection")).toBe("var(--cm-surface-selection)");
  });

  it("declares one effective variable per color and styles every role", () => {
    const declarations = editorColorDeclarations();
    expect(Object.keys(declarations)).toHaveLength(EDITOR_COLOR_IDS.length);
    for (const id of EDITOR_COLOR_IDS) {
      expect(Object.values(declarations).filter((value) => value.startsWith(`var(${editorColorVariable(id)},`))).toHaveLength(1);
    }
    const rules = editorHighlightStyle.module?.getRules() ?? "";
    for (const role of SYNTAX_ROLES) expect(rules).toContain(editorColor(role));
  });
});
