// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { insertListItemOrLeaveHeading } from "./keymap";
import { LIST_DOCUMENT, positionOf } from "./test-document";


if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

function mount(doc: string, cursor: number): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [latexTreeSupport()] }),
    parent,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("Enter in Visual mode", () => {
  it("inserts a new item after the current one", () => {
    const cursor = positionOf(LIST_DOCUMENT, "First") + "First".length;
    const editor = mount(LIST_DOCUMENT, cursor);
    expect(insertListItemOrLeaveHeading(editor)).toBe(true);
    expect(editor.state.doc.toString()).toContain("\\item First\n  \\item \n  \\item Second");
    expect(editor.state.selection.main.head).toBe(cursor + "\n  \\item ".length);
  });

  it("inserts an empty description item with the cursor inside the brackets", () => {
    const cursor = positionOf(LIST_DOCUMENT, "Meaning") + "Meaning".length;
    const editor = mount(LIST_DOCUMENT, cursor);
    expect(insertListItemOrLeaveHeading(editor)).toBe(true);
    expect(editor.state.doc.toString()).toContain("Meaning\n  \\item[] \n");
    expect(editor.state.sliceDoc(editor.state.selection.main.head - 1, editor.state.selection.main.head + 1)).toBe("[]");
  });

  it("leaves the list from an empty last item", () => {
    const text = "\\begin{itemize}\n  \\item One\n  \\item\n\\end{itemize}\nAfter\n";
    const editor = mount(text, positionOf(text, "\\item\n") + "\\item".length);
    expect(insertListItemOrLeaveHeading(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe("\\begin{itemize}\n  \\item One\n\\end{itemize}\nAfter\n");
    expect(editor.state.selection.main.head).toBe(editor.state.doc.toString().indexOf("After"));
  });

  it("jumps out of a heading to the start of the next line", () => {
    const cursor = positionOf(LIST_DOCUMENT, "Lists") + 2;
    const editor = mount(LIST_DOCUMENT, cursor);
    expect(insertListItemOrLeaveHeading(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(LIST_DOCUMENT);
    expect(editor.state.selection.main.head).toBe(positionOf(LIST_DOCUMENT, "\\begin{itemize}"));
  });

  it("does nothing outside lists and headings", () => {
    const editor = mount(LIST_DOCUMENT, positionOf(LIST_DOCUMENT, "Tail"));
    expect(insertListItemOrLeaveHeading(editor)).toBe(false);
  });
});
