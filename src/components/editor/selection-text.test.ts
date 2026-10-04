// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { setEditorView } from "@/components/editor/cm/controller";
import { activeSelectionText } from "./selection-text";

let view: EditorView | null = null;

function mount(anchor: number, head: number) {
  view = new EditorView({
    state: EditorState.create({ doc: "alpha beta gamma", selection: { anchor, head } }),
  });
  setEditorView(view);
}

afterEach(() => {
  setEditorView(null);
  view?.destroy();
  view = null;
});

describe("activeSelectionText", () => {
  it("is null without an editor or with an empty selection", () => {
    expect(activeSelectionText()).toBeNull();
    mount(3, 3);
    expect(activeSelectionText()).toBeNull();
  });

  it("returns the selected text in document order", () => {
    mount(10, 6);
    expect(activeSelectionText()).toBe("beta");
  });
});
