// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId, blockIdOf } from "./block-id";
import { parseMarkdownBody } from "./markdown/parse";
import { serializeMarkdownBody } from "./markdown/serialize";
import { createWysiwygExtensions } from "./schema";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeAtEndOf } from "./test-helpers";

afterEach(destroyOpenedEditors);

const extensions = [...createWysiwygExtensions(), BlockId];

function ids(doc: ProseMirrorNode): [string, string][] {
  const found: [string, string][] = [];
  doc.descendants((node) => {
    const id = blockIdOf(node);
    if (id) found.push([node.type.name, id]);
    return true;
  });
  return found;
}

function parsed(source: string) {
  return openMarkdown(source, { extensions });
}

function cursorBefore(editor: Editor, needle: string): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, positionAfter(editor, needle) - needle.length)));
}

function owners(doc: ProseMirrorNode): [string, string][] {
  const found: [string, string][] = [];
  doc.descendants((node) => {
    const id = blockIdOf(node);
    if (id) found.push([id, node.textContent]);
    return true;
  });
  return found;
}

describe("block ids", () => {
  it("reads a trailing ^id onto paragraphs, headings and list items", () => {
    const { editor } = parsed("## Results ^res\n\nAccuracy rose to 64% ^acc-1\n\n- first ^one\n- second\n");
    expect(ids(editor.state.doc)).toEqual([
      ["heading", "res"],
      ["paragraph", "acc-1"],
      ["listItem", "one"],
    ]);
    expect(editor.state.doc.textContent).not.toContain("^");
  });

  it("reads a lone ^id line after a table, quote, list or code block", () => {
    const source = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n^tbl\n\n> quoted\n\n^q\n\n- a\n- b\n\n^lst\n\n```js\nx\n```\n\n^code\n";
    const { editor } = parsed(source);
    expect(ids(editor.state.doc)).toEqual([
      ["table", "tbl"],
      ["blockquote", "q"],
      ["bulletList", "lst"],
      ["codeBlock", "code"],
    ]);
    const blocks: string[] = [];
    editor.state.doc.forEach((node) => {
      if (node.content.size > 0) blocks.push(node.type.name);
    });
    expect(blocks).toEqual(["table", "blockquote", "bulletList", "codeBlock"]);
  });

  it("leaves text that only looks like an id alone", () => {
    const { editor } = parsed("Use x^2 here\n\n^alone\n\nSee 2^10 and a^b c\n");
    expect(ids(editor.state.doc)).toEqual([]);
    expect(editor.state.doc.textContent).toContain("^alone");
    expect(editor.state.doc.textContent).toContain("2^10");
  });

  it("writes unchanged blocks back byte for byte", () => {
    const source = "## Results ^res\n\nAccuracy rose ^acc\n\n| a |\n| --- |\n| 1 |\n\n^tbl\n\n- item ^it\n";
    const { save } = parsed(source);
    expect(save()).toBe(source);
  });

  it("writes the id again after the block is edited", () => {
    const source = "Accuracy rose ^acc\n\n| a |\n| --- |\n| 1 |\n\n^tbl\n\n- item ^it\n\n## Head ^h\n";
    const { editor, save } = parsed(source);
    typeAtEndOf(editor, "Accuracy rose", " sharply");
    typeAtEndOf(editor, "1", "0");
    typeAtEndOf(editor, "item", "s");
    typeAtEndOf(editor, "Head", "ing");
    expect(save()).toBe("Accuracy rose sharply ^acc\n\n| a |\n| --- |\n| 10 |\n\n^tbl\n\n- items ^it\n\n## Heading ^h\n");
  });

  it("serializes ids set in the editor without a source snapshot", () => {
    const { doc } = parseMarkdownBody("One\n\n> two\n", { extensions });
    const content = doc.content ?? [];
    content[0].attrs = { ...content[0].attrs, blockId: "p1" };
    content[1].attrs = { ...content[1].attrs, blockId: "q1" };
    expect(serializeMarkdownBody(doc, null, extensions)).toBe("One ^p1\n\n> two\n\n^q1");
  });

  it("does not copy the id onto the second half of a split block", () => {
    const { editor } = parsed("Accuracy rose ^acc\n");
    const end = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end - 1)));
    editor.commands.splitBlock();
    expect(ids(editor.state.doc)).toEqual([["paragraph", "acc"]]);
  });

  it("keeps the id on the text when Enter is pressed at the start of a paragraph, heading or list item", () => {
    const paragraph = parsed("First para\n\nAccuracy rose ^acc\n");
    cursorBefore(paragraph.editor, "Accuracy");
    expect(paragraph.editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(owners(paragraph.editor.state.doc)).toEqual([["acc", "Accuracy rose"]]);
    expect(paragraph.save()).toContain("Accuracy rose ^acc");
    const heading = parsed("## Head ^h\n");
    cursorBefore(heading.editor, "Head");
    expect(heading.editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(owners(heading.editor.state.doc)).toEqual([["h", "Head"]]);
    expect(heading.save()).toContain("## Head ^h");
    const item = parsed("- alpha\n- beta ^b\n");
    cursorBefore(item.editor, "beta");
    expect(item.editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(owners(item.editor.state.doc)).toEqual([["b", "beta"]]);
    expect(item.save()).toContain("- beta ^b");
  });

  it("keeps the id on the first half only when Enter splits a block in the middle", () => {
    const { editor, save } = parsed("Accuracy rose ^acc\n");
    cursorBefore(editor, "rose");
    expect(editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(owners(editor.state.doc)).toEqual([["acc", "Accuracy "]]);
    expect(save().match(/\^acc/gu)).toEqual(["^acc"]);
    expect(save()).toContain("\n\nrose\n");
  });

  it("carries the id into the block above when Backspace joins them", () => {
    const { editor, save } = parsed("Alpha\n\nBeta here ^bb\n");
    cursorBefore(editor, "Beta");
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(owners(editor.state.doc)).toEqual([["bb", "AlphaBeta here"]]);
    expect(save()).toBe("AlphaBeta here ^bb\n");
  });

  it("keeps a list item's id on its text when the list is turned off", () => {
    const { editor, save } = parsed("- item one ^it\n");
    cursorBefore(editor, "item");
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(owners(editor.state.doc)).toEqual([["it", "item one"]]);
    expect(save()).toBe("item one ^it\n");
  });

  it("keeps a list item's id on its text when a block command lifts it out of the list", () => {
    const { editor, save } = parsed("- one ^o1\n- Alpha ^aa\n- three ^t3\n");
    cursorBefore(editor, "pha");
    expect(editor.commands.toggleHeading({ level: 2 })).toBe(true);
    expect(owners(editor.state.doc)).toEqual([
      ["o1", "one"],
      ["aa", "Alpha"],
      ["t3", "three"],
    ]);
    expect(save()).toContain("## Alpha ^aa");
  });

  it("drops the id of a deleted block instead of handing it to a neighbour", () => {
    const { editor, save } = parsed("Alpha\n\nBeta ^bb\n\nGamma\n");
    const first = editor.state.doc.child(0);
    const second = editor.state.doc.child(1);
    editor.view.dispatch(editor.state.tr.delete(first.nodeSize, first.nodeSize + second.nodeSize));
    expect(owners(editor.state.doc)).toEqual([]);
    expect(save()).toBe("Alpha\n\nGamma\n");
  });

  it("clears the id of a pasted copy and keeps the original", () => {
    const { editor } = parsed("Accuracy rose ^acc\n\nOther\n");
    const first = editor.state.doc.firstChild as ProseMirrorNode;
    const slice = new Slice(editor.state.doc.content.cut(0, first.nodeSize), 0, 0);
    editor.view.dispatch(editor.state.tr.replace(0, 0, slice));
    const found: (string | null)[] = [];
    editor.state.doc.forEach((node) => found.push(blockIdOf(node)));
    expect(found).toEqual([null, "acc", null]);
  });
});
