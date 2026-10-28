import { ensureSyntaxTree, type LanguageSupport } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { markdownLanguage, quartoLanguage } from "./markdown";

function math(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [markdownLanguage()] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  if (!tree) throw new Error("The Markdown tree did not finish parsing");
  const found: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "PandocMath") found.push(doc.slice(node.from, node.to));
    },
  });
  return found;
}

describe("Pandoc math in Markdown", () => {
  it("recognises inline and display math", () => {
    expect(math("Inline $a+b$ and display $$c$$ here.")).toEqual(["$a+b$", "$$c$$"]);
  });

  it("skips escaped dollars but not a dollar after an escaped backslash", () => {
    expect(math("Price \\$5 and \\$6.")).toEqual([]);
    expect(math("Path \\\\$x$ end.")).toEqual(["$x$"]);
  });

  it("requires inline math to hug its content and stay on one line", () => {
    expect(math("Costs $ 5 and $6 now.")).toEqual([]);
    expect(math("A $x $ b.")).toEqual([]);
    expect(math("A $x\ny$ b.")).toEqual([]);
    expect(math("A $")).toEqual([]);
  });

  it("allows escaped characters inside math and display math across lines", () => {
    expect(math("A $a\\$b$ end.")).toEqual(["$a\\$b$"]);
    expect(math("$$\na\n$$")).toEqual(["$$\na\n$$"]);
    expect(math("Open $$never closed")).toEqual([]);
  });
});

function parsed(doc: string, support: LanguageSupport = markdownLanguage()) {
  const state = EditorState.create({ doc, extensions: [support] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  if (!tree) throw new Error("The Markdown tree did not finish parsing");
  return tree;
}

function nodeTexts(doc: string, name: string, support?: LanguageSupport): string[] {
  const found: string[] = [];
  parsed(doc, support).iterate({
    enter(node) {
      if (node.name === name) found.push(doc.slice(node.from, node.to));
    },
  });
  return found;
}

function classesAt(doc: string, token: string, support?: LanguageSupport): string[] {
  const from = doc.indexOf(token);
  const classes: string[] = [];
  highlightTree(parsed(doc, support), classHighlighter, (spanFrom, spanTo, spanClasses) => {
    if (spanFrom < from + token.length && spanTo > from) classes.push(spanClasses);
  });
  return classes;
}

describe("YAML front matter in Markdown", () => {
  it("reads a leading metadata block as YAML rather than a heading", () => {
    const doc = "---\ntitle: Paper\nauthor: Ada\n---\n\n# Intro\n";
    expect(nodeTexts(doc, "FrontMatter")).toEqual(["---\ntitle: Paper\nauthor: Ada\n---"]);
    expect(nodeTexts(doc, "FrontMatterContent")).toEqual(["title: Paper\nauthor: Ada"]);
    expect(nodeTexts(doc, "SetextHeading2")).toEqual([]);
    expect(nodeTexts(doc, "ATXHeading1")).toEqual(["# Intro"]);
    expect(classesAt(doc, "title")).toContain("tok-atom");
    expect(classesAt(doc, "Ada").some((classes) => classes.includes("tok-heading"))).toBe(false);
  });

  it("accepts the dotted terminator and Quarto documents", () => {
    const doc = "---\nformat: pdf\n...\nBody\n";
    expect(nodeTexts(doc, "FrontMatter", quartoLanguage())).toEqual(["---\nformat: pdf\n..."]);
    expect(nodeTexts(doc, "Paragraph", quartoLanguage())).toEqual(["Body"]);
  });

  it("leaves a rule followed by a blank line, and later rules, alone", () => {
    expect(nodeTexts("---\n\nText\n", "FrontMatter")).toEqual([]);
    expect(nodeTexts("---\n\nText\n", "HorizontalRule")).toEqual(["---"]);
    expect(nodeTexts("Text\n\n---\ntitle: x\n---\n", "FrontMatter")).toEqual([]);
  });

  it("runs to the end of the document while the closing line is missing", () => {
    expect(nodeTexts("---\ntitle: Draft\n", "FrontMatter")).toEqual(["---\ntitle: Draft"]);
    expect(nodeTexts("---", "FrontMatter")).toEqual([]);
  });
});

describe("Quarto shortcodes", () => {
  it("marks a shortcode in a Quarto document", () => {
    const doc = "See {{< include _intro.qmd >}} and {{< pagebreak >}} here.";
    expect(nodeTexts(doc, "QuartoShortcode", quartoLanguage())).toEqual([
      "{{< include _intro.qmd >}}",
      "{{< pagebreak >}}",
    ]);
    expect(classesAt(doc, "pagebreak", quartoLanguage())).toContain("tok-meta");
  });

  it("leaves an unclosed shortcode and plain Markdown braces alone", () => {
    expect(nodeTexts("Open {{< pagebreak here", "QuartoShortcode", quartoLanguage())).toEqual([]);
    expect(nodeTexts("See {{< pagebreak >}}", "QuartoShortcode")).toEqual([]);
  });
});
