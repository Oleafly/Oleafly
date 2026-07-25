// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorRedo,
  editorUndo,
  insertTemplate,
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
