// @vitest-environment jsdom
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeAtEndOf } from "../test-helpers";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

afterEach(destroyOpenedEditors);

const ALIGNED = "| Condition | Value |\n|:--|--:|\n| P(A \\| B) | 0.3 |";

function mathRanges(source: string) {
  return [...source.matchAll(/\$[^$\n]+\$/gu)].map((match) => ({ from: match.index, to: match.index + match[0].length }));
}

describe("Markdown tables", () => {
  it.each([
    ["an escaped pipe and the alignment row", ALIGNED, "0.3", "5", ALIGNED.replace("0.3", "0.35")],
    ["a pipe inside inline code", "| a | b |\n| --- | --- |\n| `x\\|y` | 1 |", "1", "2", "| a | b |\n| --- | --- |\n| `x\\|y` | 12 |"],
    ["math with a bare pipe", "| a | b |\n| --- | --- |\n| $|x|$ | 1 |", "1", "2", "| a | b |\n| --- | --- |\n| $|x|$ | 12 |"],
    ["math alone in a cell", "| a | b |\n| --- | --- |\n| $x$ | 1 |", "1", "2", "| a | b |\n| --- | --- |\n| $x$ | 12 |"],
    ["a table in a quote", "> | a | b |\n> |:-:|---|\n> | 1 | 2 |", "2", "3", "> | a | b |\n> |:-:|---|\n> | 1 | 23 |"],
    ["the padding of rows that did not change", "| Sample | Rate |\n|:-------|-----:|\n| A1     | 1.21 |\n| A2     | 2.05 |", "2.05", "9", "| Sample | Rate |\n|:-------|-----:|\n| A1     | 1.21 |\n| A2 | 2.059 |"],
    ["a backslash before a pipe in text", "| a | b |\n| --- | --- |\n| x\\\\\\|y | 1 |", "1", "2", "| a | b |\n| --- | --- |\n| x\\\\\\|y | 12 |"],
  ])("keeps %s when a cell is edited", (_name, source, needle, typed, saved) => {
    const { editor, save } = openMarkdown(source, { preservedInlineRanges: mathRanges(source) });
    typeAtEndOf(editor, needle, typed);
    expect(save()).toBe(saved);
  });

  it("reads the alignment of each column", () => {
    const { doc } = parseMarkdownBody("| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |");
    const header = doc.content?.[0].content?.[0].content ?? [];
    expect(header.map((cell) => cell.attrs?.align)).toEqual(["left", "center", "right", null]);
  });

  it("writes a new alignment row when a column changes alignment", () => {
    const { editor, save } = openMarkdown(ALIGNED);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, positionAfter(editor, "Valu"))));
    expect(editor.commands.setTableColumnAlign("center")).toBe(true);
    expect(save()).toBe("| Condition | Value |\n| :-- | :-: |\n| P(A \\| B) | 0.3 |");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, positionAfter(editor, "P(A"))));
    editor.commands.setTableColumnAlign(null);
    expect(save()).toBe("| Condition | Value |\n| --- | :-: |\n| P(A \\| B) | 0.3 |");
  });

  it("refuses to align outside a table", () => {
    const { editor } = openMarkdown("Text\n");
    expect(editor.commands.setTableColumnAlign("left")).toBe(false);
  });

  it("writes a table with no source alignment row in the default form", () => {
    const { doc } = parseMarkdownBody("| a | b |\n|---|--:|\n| 1 | 2 |");
    const cells = doc.content?.[0].content?.[0].content ?? [];
    cells[1].attrs = { ...cells[1].attrs, align: "left" };
    expect(serializeMarkdownBody(doc)).toBe("| a | b |\n| --- | :-- |\n| 1 | 2 |");
  });
});
