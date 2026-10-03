// @vitest-environment jsdom

import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { historySignalExtension, publishVisualEditorHistory, useEditorHistory } from "./history-signal";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  publishVisualEditorHistory(null);
  document.body.replaceChildren();
});

function mount(doc: string): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), historySignalExtension()] }),
    parent: document.body,
  });
  return view;
}

describe("editor history availability", () => {
  it("follows the source editor's undo and redo stacks", () => {
    const editor = mount("a");
    const { result } = renderHook(() => useEditorHistory());
    expect(result.current).toEqual({ canUndo: false, canRedo: false });

    act(() => editor.dispatch({ changes: { from: 1, insert: "b" } }));
    expect(result.current).toEqual({ canUndo: true, canRedo: false });

    act(() => {
      undo(editor);
    });
    expect(result.current).toEqual({ canUndo: false, canRedo: true });

    act(() => {
      redo(editor);
    });
    expect(result.current).toEqual({ canUndo: true, canRedo: false });
  });

  it("starts from the new document's history when the editor state is replaced", () => {
    const editor = mount("a");
    const { result } = renderHook(() => useEditorHistory());
    act(() => editor.dispatch({ changes: { from: 1, insert: "b" } }));
    expect(result.current.canUndo).toBe(true);

    act(() => editor.setState(EditorState.create({ doc: "other", extensions: [history(), historySignalExtension()] })));
    expect(result.current).toEqual({ canUndo: false, canRedo: false });
  });

  it("keeps the visual editor's history separate from the source editor's", () => {
    mount("a");
    const source = renderHook(() => useEditorHistory());
    const visual = renderHook(() => useEditorHistory(true));

    act(() => publishVisualEditorHistory({ canUndo: true, canRedo: true }));
    expect(visual.result.current).toEqual({ canUndo: true, canRedo: true });
    expect(source.result.current).toEqual({ canUndo: false, canRedo: false });
  });
});
