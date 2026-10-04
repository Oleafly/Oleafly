// @vitest-environment jsdom

import { history } from "@codemirror/commands";
import { searchPanelOpen, search } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  editBackgroundDocument,
  editorFind,
  editorRedo,
  editorUndo,
  editorVimRedo,
  editorVimUndo,
  focusEditor,
  getCurrentLine,
  getEditorDocumentPath,
  getEditorView,
  gotoLine,
  gotoRange,
  insertAtCursor,
  insertEnvironment,
  insertListEnvironment,
  insertTemplate,
  insertText,
  registerBackgroundDocumentEditor,
  replaceRange,
  selectWordNearLine,
  setEditorDocumentPath,
  setEditorView,
  subscribeEditorDocument,
  waitForEditorDocument,
  wrapSelection,
  wrapSelectionOrPlaceholder,
} from "./controller";

let view: EditorView | null = null;

function mount(doc: string, anchor = 0, head = anchor): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [history(), search()] }),
    parent: document.body,
  });
  setEditorView(view);
  return view;
}

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("tracking the document in the shared editor", () => {
  it("notifies subscribers immediately and on every change until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEditorDocument(listener);
    expect(listener).toHaveBeenLastCalledWith(null, null);
    const editor = mount("text");
    expect(listener).toHaveBeenLastCalledWith(null, editor);
    setEditorDocumentPath("main.tex");
    expect(getEditorDocumentPath()).toBe("main.tex");
    expect(listener).toHaveBeenLastCalledWith("main.tex", editor);
    unsubscribe();
    setEditorDocumentPath("other.tex");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("forgets the document path when the view goes away", () => {
    mount("text");
    setEditorDocumentPath("main.tex");
    setEditorView(null);
    expect(getEditorView()).toBeNull();
    expect(getEditorDocumentPath()).toBeNull();
  });

  it("resolves at once when the document is already loaded", async () => {
    const editor = mount("text");
    setEditorDocumentPath("main.tex");
    await expect(waitForEditorDocument("main.tex")).resolves.toBe(editor);
  });

  it("resolves with nothing for an already aborted wait", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitForEditorDocument("main.tex", controller.signal)).resolves.toBeNull();
  });

  it("waits until the matching document is installed", async () => {
    const controller = new AbortController();
    const waiting = waitForEditorDocument("chapter.tex", controller.signal);
    const editor = mount("text");
    setEditorDocumentPath("other.tex");
    setEditorDocumentPath("chapter.tex");
    await expect(waiting).resolves.toBe(editor);
    const listener = vi.fn();
    subscribeEditorDocument(listener)();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the request is aborted", async () => {
    const controller = new AbortController();
    const waiting = waitForEditorDocument("chapter.tex", controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeNull();
    mount("text");
    setEditorDocumentPath("chapter.tex");
  });
});

describe("editing documents that are not open", () => {
  it("routes edits to the registered editor and stops after it unregisters", () => {
    expect(editBackgroundDocument("a.tex", "base", [])).toBe(false);
    const editor = vi.fn(() => true);
    const unregister = registerBackgroundDocumentEditor(editor);
    const changes = [{ from: 0, to: 1, insert: "x" }];
    expect(editBackgroundDocument("a.tex", "base", changes)).toBe(true);
    expect(editor).toHaveBeenCalledWith("a.tex", "base", changes);
    const replacement = vi.fn(() => false);
    const unregisterReplacement = registerBackgroundDocumentEditor(replacement);
    unregister();
    expect(editBackgroundDocument("a.tex", "base", changes)).toBe(false);
    expect(replacement).toHaveBeenCalledTimes(1);
    unregisterReplacement();
    expect(editBackgroundDocument("a.tex", "base", changes)).toBe(false);
    expect(replacement).toHaveBeenCalledTimes(1);
  });
});

describe("editor commands without a view", () => {
  it("does nothing and reports nothing", () => {
    setEditorView(null);
    expect(getCurrentLine()).toBeNull();
    expect(selectWordNearLine(1, "word")).toBe(false);
    expect(editorVimUndo()).toBe(false);
    expect(editorVimRedo()).toBe(false);
    for (const command of [
      () => gotoLine(1),
      () => gotoRange(0, 1),
      () => insertAtCursor("x"),
      () => replaceRange(0, 1, "x"),
      () => wrapSelection("(", ")"),
      () => insertTemplate("x", 0, 0),
      () => wrapSelectionOrPlaceholder("(", ")", "x"),
      () => insertEnvironment("center"),
      () => insertListEnvironment("itemize"),
      () => focusEditor(),
      () => editorUndo(),
      () => editorRedo(),
      () => editorFind(),
    ]) {
      expect(command).not.toThrow();
    }
  });
});

describe("editor commands on the shared view", () => {
  it("reports the cursor line", () => {
    mount("one\ntwo\nthree", 6);
    expect(getCurrentLine()).toBe(2);
  });

  it("clamps a range before selecting it", () => {
    const editor = mount("hello world");
    gotoRange(-5, 99);
    expect(editor.state.selection.main.from).toBe(0);
    expect(editor.state.selection.main.to).toBe(11);
  });

  it("inserts text at the cursor as its own undo step", () => {
    const editor = mount("ab", 1);
    insertAtCursor("X");
    insertText("Y");
    expect(editor.state.doc.toString()).toBe("aXYb");
    expect(editor.state.selection.main.head).toBe(3);
    editorUndo();
    expect(editor.state.doc.toString()).toBe("aXb");
  });

  it("replaces a range and clamps a stale range to the document", () => {
    const editor = mount("hello world");
    replaceRange(6, 11, "there");
    expect(editor.state.doc.toString()).toBe("hello there");
    replaceRange(20, 30, "!");
    expect(editor.state.doc.toString()).toBe("hello there!");
    replaceRange(-3, 5, "Hi");
    expect(editor.state.doc.toString()).toBe("Hi there!");
    expect(editor.state.selection.main.head).toBe(2);
  });

  it("wraps the selection and keeps the wrapped text selected", () => {
    const editor = mount("say word now", 4, 8);
    wrapSelection("\\emph{", "}");
    expect(editor.state.doc.toString()).toBe("say \\emph{word} now");
    const { from, to } = editor.state.selection.main;
    expect(editor.state.sliceDoc(from, to)).toBe("word");
  });

  it("wraps the selection or inserts a selected placeholder", () => {
    const editor = mount("a  b", 2);
    wrapSelectionOrPlaceholder("\\textbf{", "}", "text");
    expect(editor.state.doc.toString()).toBe("a \\textbf{text} b");
    expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe("text");
    const second = mount("x bold y", 2, 6);
    wrapSelectionOrPlaceholder("\\textbf{", "}", "text");
    expect(second.state.doc.toString()).toBe("x \\textbf{bold} y");
  });

  it("wraps the selection in an environment with the cursor after the content", () => {
    const editor = mount("body", 0, 4);
    insertEnvironment("center");
    expect(editor.state.doc.toString()).toBe("\\begin{center}\n  body\n\\end{center}\n");
    expect(editor.state.selection.main.head).toBe("\\begin{center}\n  body".length);
  });

  it("opens the search panel", () => {
    const editor = mount("find me");
    editorFind();
    expect(searchPanelOpen(editor.state)).toBe(true);
  });

  it("focuses the editor", () => {
    const editor = mount("text");
    const focus = vi.spyOn(editor, "focus");
    focusEditor();
    expect(focus).toHaveBeenCalled();
  });

  it("ignores an empty word and reports words it cannot find", () => {
    mount("alpha\nbeta\n");
    expect(selectWordNearLine(1, "   ")).toBe(false);
    expect(selectWordNearLine(1, "gamma")).toBe(false);
  });

  it("searches neighbouring lines and falls back to a match inside a longer word", () => {
    const editor = mount("one\ntwo\nthree\nnetwork\n");
    expect(selectWordNearLine(1, "work")).toBe(true);
    const { from, to } = editor.state.selection.main;
    expect([editor.state.doc.lineAt(from).number, editor.state.sliceDoc(from, to)]).toEqual([4, "work"]);
    expect(selectWordNearLine(99, "three")).toBe(true);
    expect(editor.state.doc.lineAt(editor.state.selection.main.from).number).toBe(3);
  });
});
