// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it } from "vitest";
import { markdownMathRanges, noteMathRanges } from "./markdown-source";

const opened: Editor[] = [];

afterEach(() => {
  for (const editor of opened.splice(0)) editor.destroy();
});

function reopen(source: string) {
  const blocks = parseMarkdownBody(source, { preservedInlineRanges: markdownMathRanges(source) }).doc.content ?? [];
  return blocks.map((block) => block.content?.map((node) => node.text ?? node.type).join(""));
}

function typed(text: string): string {
  const { doc, layout } = parseMarkdownBody("");
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: doc });
  opened.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  editor.view.dispatch(editor.state.tr.insertText(text, 1));
  return serializeMarkdownBody(editor.getJSON(), snapshot);
}

describe("markdownMathRanges", () => {
  it("reads only the dollar math that Pandoc's Markdown reads", () => {
    const source = "---\ntitle: $t$\n---\nsee \\[1\\] and \\(x\\) and $y$";
    expect(markdownMathRanges(source).map(({ from, to }) => source.slice(from, to))).toEqual(["$y$"]);
  });

  it("reads typed brackets back as the text that was typed", () => {
    const saved = typed("see [1] here");
    expect(saved).toBe("see \\[1\\] here");
    expect(reopen(saved)).toEqual(["see [1] here"]);
  });

  it("leaves a dollar sign with no closer as text", () => {
    expect(markdownMathRanges("It costs <del>$</del>5 and $10 later, so budget $15.")).toEqual([]);
    expect(markdownMathRanges("It costs $x and more.")).toEqual([]);
    expect(reopen("It costs <del>$</del>5 and $10 later.")).toEqual(["It costs $5 and $10 later."]);
  });

  it("keeps paragraphs apart when brackets open and close in different ones", () => {
    const source = "see \\[a here\n\nmiddle\n\nand b\\] end";
    expect(reopen(source)).toEqual(["see [a here", "middle", "and b] end"]);
  });
});

describe("noteMathRanges", () => {
  const found = (source: string) => noteMathRanges(source).map(({ from, to }) => source.slice(from, to));

  it("reads bracketed LaTeX math in notes, as notes did before", () => {
    expect(found("Inline \\(\\alpha + x^2\\) here and $y$.\n\n\\[ \\frac{a}{b} \\]")).toEqual([
      "\\(\\alpha + x^2\\)",
      "$y$",
      "\\[ \\frac{a}{b} \\]",
    ]);
  });

  it("leaves escaped brackets inside text, or around plain words, as text", () => {
    expect(found("See word \\[1\\] and \\[a b\\] here")).toEqual([]);
    expect(found("\\[TODO\\]\n\nSee \\[1\\] reference")).toEqual([]);
    expect(found("\\[ x^2 \\]")).toEqual(["\\[ x^2 \\]"]);
  });

  it("keeps paragraphs apart when brackets or dollars open and close in different ones", () => {
    expect(found("see \\[a here\n\nmiddle $x$\n\nand b\\] end")).toEqual(["$x$"]);
    expect(found("costs $5\n\nand $x$")).toEqual(["$x$"]);
  });
});
