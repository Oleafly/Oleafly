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
  selectWordNearLine,
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
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("selectWordNearLine occurrence targeting", () => {
  const line = "The model uses a model of the model to predict the model output.";

  function mount(doc: string) {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({ parent, state: EditorState.create({ doc }) });
    setEditorView(view);
    return view;
  }

  it("selects the requested occurrence of a repeated word", () => {
    const v = mount(line);
    expect(selectWordNearLine(1, "model", 2)).toBe(true);
    const selection = v.state.selection.main;
    expect(selection.from).toBe(line.indexOf("model", 25));
    expect(v.state.doc.sliceString(selection.from, selection.to)).toBe("model");
  });

  it("still selects the first occurrence when none is requested", () => {
    const v = mount(line);
    expect(selectWordNearLine(1, "model")).toBe(true);
    expect(v.state.selection.main.from).toBe(line.indexOf("model"));
  });

  it("selects the last occurrence for the last index", () => {
    const v = mount(line);
    expect(selectWordNearLine(1, "model", 3)).toBe(true);
    expect(v.state.selection.main.from).toBe(line.lastIndexOf("model"));
  });

  it("falls back to the first occurrence when the line has fewer than requested", () => {
    const v = mount("only one model on this line");
    expect(selectWordNearLine(1, "model", 4)).toBe(true);
    expect(v.state.selection.main.from).toBe("only one model on this line".indexOf("model"));
  });

  it("keeps searching neighbouring lines when the target line lacks the word", () => {
    const v = mount(`first line\n${line}`);
    expect(selectWordNearLine(1, "model", 2)).toBe(true);
    expect(v.state.doc.sliceString(v.state.selection.main.from, v.state.selection.main.to)).toBe("model");
  });
});
