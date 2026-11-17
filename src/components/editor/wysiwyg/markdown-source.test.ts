// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS, createMarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { afterEach, describe, expect, it } from "vitest";
import { markdownMathRanges } from "./markdown-source";

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

  it("keeps paragraphs apart when brackets open and close in different ones", () => {
    const source = "see \\[a here\n\nmiddle\n\nand b\\] end";
    expect(reopen(source)).toEqual(["see [a here", "middle", "and b] end"]);
  });
});
