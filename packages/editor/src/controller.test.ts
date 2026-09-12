// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorRedo,
  editorUndo,
  gotoLine,
  insertTemplate,
  revealEditorRange,
  setEditorView,
} from "./controller";

let view: EditorView | null = null;

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("editor controller history", () => {
  it("keeps consecutive toolbar insertions as separate undo steps", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ extensions: [history()] }),
    });
    setEditorView(view);

    insertTemplate("FIRST", 5, 5);
    insertTemplate("SECOND", 6, 6);
    expect(view.state.doc.toString()).toBe("FIRSTSECOND");

    editorUndo();
    expect(view.state.doc.toString()).toBe("FIRST");

    editorRedo();
    expect(view.state.doc.toString()).toBe("FIRSTSECOND");
  });
});

describe("editor controller navigation", () => {
  it("synchronizes the DOM selection when navigation returns focus from a toolbar", () => {
    const parent = document.createElement("div");
    const toolbar = document.createElement("button");
    document.body.append(parent, toolbar);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc: "original reference\nselected definition" }),
    });
    view.focus();
    toolbar.focus();

    revealEditorRange(view, 19, 38);

    const selection = window.getSelection()!;
    expect(view.state.selection.main.from).toBe(19);
    expect(view.state.selection.main.to).toBe(38);
    expect(view.posAtDOM(selection.anchorNode!, selection.anchorOffset)).toBe(19);
    expect(view.posAtDOM(selection.focusNode!, selection.focusOffset)).toBe(38);
  });

  it("centers a distant source line without scrolling the application shell", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join(
          "\n",
        ),
      }),
    });
    setEditorView(view);

    document.documentElement.scrollTop = 47;
    document.body.scrollTop = 31;
    Object.defineProperty(view.scrollDOM, "clientHeight", {
      configurable: true,
      value: 160,
    });
    const focus = vi
      .spyOn(view.contentDOM, "focus")
      .mockImplementation(() => undefined);
    const originalRequestMeasure = view.requestMeasure.bind(view);
    vi.spyOn(view, "requestMeasure").mockImplementation((request) => {
      if (!request) {
        originalRequestMeasure();
        return;
      }
      const measured = request.read(view!);
      request.write?.(measured, view!);
    });

    gotoLine(96);

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(
      96,
    );
    expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
    expect(document.documentElement.scrollTop).toBe(47);
    expect(document.body.scrollTop).toBe(31);
    expect(focus).toHaveBeenCalled();
  });
});
