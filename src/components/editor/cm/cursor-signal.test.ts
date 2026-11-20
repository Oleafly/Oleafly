// @vitest-environment jsdom

import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { cursorSignalExtension, editorSelectionRevision, editorSelectionTyped } from "./cursor-signal";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function open(): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc: "Alpha bravo.\n", extensions: [history(), cursorSignalExtension()] }) });
  views.push(view);
  return view;
}

describe("the selection signal", () => {
  it.each(["input.type", "input", "input.format", "input.paste", "delete.backward"])("counts a %s edit as typed", (userEvent) => {
    const view = open();
    const revision = editorSelectionRevision();
    view.dispatch({ changes: { from: 0, insert: "X" }, userEvent });
    expect(editorSelectionRevision()).toBe(revision + 1);
    expect(editorSelectionTyped()).toBe(true);
  });

  it("counts undo and redo as typed", () => {
    const view = open();
    view.dispatch({ changes: { from: 0, insert: "X" }, userEvent: "input.type" });
    view.dispatch({ selection: { anchor: 3 }, userEvent: "select.pointer" });
    expect(editorSelectionTyped()).toBe(false);
    undo(view);
    expect(editorSelectionTyped()).toBe(true);
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select" });
    redo(view);
    expect(editorSelectionTyped()).toBe(true);
  });

  it("does not count a click, an arrow key or a change from outside as typed", () => {
    const view = open();
    view.dispatch({ selection: { anchor: 4 }, userEvent: "select.pointer" });
    expect(editorSelectionTyped()).toBe(false);
    view.dispatch({ selection: { anchor: 5 }, userEvent: "select" });
    expect(editorSelectionTyped()).toBe(false);
    view.dispatch({ changes: { from: 0, insert: "Y" } });
    expect(editorSelectionTyped()).toBe(false);
  });
});
