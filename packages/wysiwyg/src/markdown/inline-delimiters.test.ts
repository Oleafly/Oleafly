// @vitest-environment jsdom
import type { Editor, JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeText } from "../test-helpers";
import { parseMarkdownBody } from "./parse";

afterEach(destroyOpenedEditors);

const runsOf = (content: JSONContent[] | undefined) =>
  (content ?? []).map((node) => [node.text ?? node.type, (node.marks ?? []).map((mark) => mark.type).sort().join(", ")]);

const readBack = (saved: string) => runsOf(parseMarkdownBody(saved).doc.content?.[0]?.content);

function marked(source: string, word: string, mark: string): { editor: Editor; saved: string } {
  const { editor, save } = openMarkdown(source);
  const to = positionAfter(editor, word);
  editor.chain().setTextSelection({ from: to - word.length, to }).toggleMark(mark).run();
  return { editor, saved: save() };
}

describe("mark delimiters next to punctuation", () => {
  it.each([
    ["Use x^2 here.", "x^", "bold", "Use **x**^2 here."],
    ["Use x^2 here.", "x^", "italic", "Use *x*^2 here."],
    ["Use x^2 here.", "x^", "strike", "Use ~~x~~^2 here."],
    ["Use x^2 here.", "^2", "bold", "Use x^**2** here."],
    ["Use a_b here.", "a_", "bold", "Use **a**\\_b here."],
    ["Use a_b here.", "_b", "bold", "Use a\\_**b** here."],
    ["Use x~2 here.", "x~", "bold", "Use **x**\\~2 here."],
    ["See [1]s here.", "[1]", "bold", "See **\\[1**\\]s here."],
    ["Use a*b here.", "a*", "bold", "Use **a**\\*b here."],
    ["Use a*b here.", "*b", "bold", "Use a\\***b** here."],
    ["Use x😀y here.", "x😀", "bold", "Use **x**😀y here."],
  ])("steps a delimiter over whole characters and escapes in %j (%s, %s)", (source, word, mark, saved) => {
    expect(marked(source, word, mark).saved).toBe(saved);
    expect(readBack(saved).filter(([, marks]) => marks !== "").length).toBe(1);
  });

  it.each([
    ["A **strong word**s end.", "word", "underline", "A <strong>strong <u>word</u></strong>s end."],
    ["A **strong word**s end.", "word", "highlight", "A <strong>strong <mark>word</mark></strong>s end."],
    ["Use a.b here.", ".", "bold", "Use a<strong>.</strong>b here."],
    ["If a&lt;b and c>d.", "a<", "bold", "If <strong>a<</strong>b and c>d."],
  ])("writes tags when a delimiter would have to enter other markup in %j (%s, %s)", (source, word, mark, saved) => {
    const { editor, saved: written } = marked(source, word, mark);
    expect(written).toBe(saved);
    expect(readBack(written)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });

  it("keeps a strike's delimiters whole when it closes together with bold", () => {
    const { editor, save } = openMarkdown("Plain **bold run** after.");
    editor.chain().setTextSelection({ from: positionAfter(editor, "bold "), to: positionAfter(editor, "aft") }).toggleStrike().run();
    typeText(editor, "X");
    const saved = save();
    expect(saved).toBe("Plain <strong>bold ~~X~~</strong>er.");
    expect(readBack(saved)).toEqual(runsOf(editor.getJSON().content?.[0]?.content));
  });
});
