// @vitest-environment jsdom

import { EditorSelection, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ancestorAt, latexTreeSupport } from "../latex-tree";
import {
  extendBackwardsOverEmptyLines,
  extendForwardsOverEmptyLines,
  hasMouseDownEffect,
  mouseDownEffect,
  placeSelectionInsideBlock,
  pointerSelectionTracking,
  scrollAdjustment,
  selectionAtMouseDown,
  selectionIntersects,
  selectNodeContent,
} from "./selection";
import { parsedView, positionOf } from "./test-document";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

function mount(doc: string, cursor = 0): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [latexTreeSupport(), pointerSelectionTracking, scrollAdjustment],
    }),
    parent,
  });
  return parsedView(view);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("selection geometry helpers", () => {
  it("reports whether any range touches the extents", () => {
    const selection = EditorSelection.create([EditorSelection.range(2, 4), EditorSelection.cursor(10)]);
    expect(selectionIntersects(selection, { from: 4, to: 6 })).toBe(true);
    expect(selectionIntersects(selection, { from: 0, to: 2 })).toBe(true);
    expect(selectionIntersects(selection, { from: 10, to: 12 })).toBe(true);
    expect(selectionIntersects(selection, { from: 5, to: 9 })).toBe(false);
  });

  it("extends over empty lines in both directions up to a limit", () => {
    const doc = Text.of(["a", "", " ", "b", "", "", "c"]);
    const b = doc.line(4);
    expect(extendBackwardsOverEmptyLines(doc, b)).toBe(doc.line(2).from);
    expect(extendBackwardsOverEmptyLines(doc, b, 1)).toBe(doc.line(3).from);
    expect(extendForwardsOverEmptyLines(doc, b)).toBe(doc.line(6).to);
    expect(extendForwardsOverEmptyLines(doc, b, 1)).toBe(doc.line(5).to);
    expect(extendBackwardsOverEmptyLines(doc, doc.line(1))).toBe(0);
    expect(extendForwardsOverEmptyLines(doc, doc.line(7))).toBe(doc.length);
  });
});

describe("placing the cursor from a pointer event", () => {
  it("moves the cursor to the end of the clicked block and adds a range with Ctrl", () => {
    const editor = mount("first line\nsecond line\n", 0);
    const block = editor.lineBlockAtHeight(0);
    const plain = placeSelectionInsideBlock(editor, new MouseEvent("mouseup", { clientY: 0 }));
    expect(plain.selection).toEqual(EditorSelection.cursor(block.to));
    const added = placeSelectionInsideBlock(editor, new MouseEvent("mouseup", { clientY: 0, ctrlKey: true }));
    expect((added.selection as EditorSelection).ranges).toHaveLength(2);
  });

  it("selects the content inside a node's delimiters", () => {
    const doc = "\\textbf{bold}\n";
    const editor = mount(doc, doc.length);
    const argument = ancestorAt(editor.state, positionOf(doc, "bold"), "TextArgument");
    if (!argument) throw new Error("no argument");
    selectNodeContent(editor, argument);
    const { from, to } = editor.state.selection.main;
    expect(doc.slice(from, to)).toBe("bold");
  });
});

describe("pointer selection tracking", () => {
  it("remembers the selection at mouse down and releases it after the mouse is released", () => {
    const editor = mount("some text here\n", 3);
    editor.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    expect(selectionAtMouseDown(editor.state)?.main.head).toBe(3);
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(selectionAtMouseDown(editor.state)).toBeDefined();
    vi.runAllTimers();
    expect(selectionAtMouseDown(editor.state)).toBeUndefined();
  });

  it("maps the remembered selection through edits made while the mouse is down", () => {
    const editor = mount("some text here\n", 3);
    editor.dispatch({ effects: mouseDownEffect.of(true) });
    editor.dispatch({ changes: { from: 0, insert: "ab" } });
    expect(selectionAtMouseDown(editor.state)?.main.head).toBe(5);
  });

  it("releases after a context menu or a drop without a mouse up", () => {
    const editor = mount("some text here\n", 3);
    for (const type of ["contextmenu", "drop"]) {
      editor.dispatch({ effects: mouseDownEffect.of(true) });
      editor.contentDOM.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      vi.runAllTimers();
      expect(selectionAtMouseDown(editor.state), type).toBeUndefined();
    }
  });

  it("does not dispatch the release into a view that was removed from the page", () => {
    const editor = mount("some text here\n", 3);
    editor.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    window.dispatchEvent(new MouseEvent("mouseup"));
    editor.dom.remove();
    vi.runAllTimers();
    expect(selectionAtMouseDown(editor.state)).toBeDefined();
  });

  it("re-arms on a second mouse down without leaking the first listener", () => {
    const editor = mount("some text here\n", 3);
    const remove = vi.spyOn(window, "removeEventListener");
    editor.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    editor.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    expect(remove.mock.calls.filter(([type]) => type === "mouseup")).toHaveLength(1);
    remove.mockRestore();
  });
});

describe("scroll adjustment on release", () => {
  it("scrolls the selection into view when the mouse is released", () => {
    const state = EditorState.create({ doc: "abc", extensions: [scrollAdjustment] });
    const released = state.update({ effects: mouseDownEffect.of(false) });
    expect(released.effects).toHaveLength(2);
    expect(hasMouseDownEffect(released)).toBe(true);
    expect(state.update({ effects: mouseDownEffect.of(true) }).effects).toHaveLength(1);
    expect(state.update({ effects: mouseDownEffect.of(false), scrollIntoView: true }).effects).toHaveLength(1);
    expect(hasMouseDownEffect(state.update({}))).toBe(false);
  });
});
