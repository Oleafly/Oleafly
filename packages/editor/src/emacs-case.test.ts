// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { emacsModeExtension } from "./emacs-mode";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function regionView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
      extensions: [emacsModeExtension()],
    }),
  });
  view.focus();
  return view;
}

function ctrl(target: EditorView, key: string, keyCode: number): void {
  target.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code: `Key${key.toUpperCase()}`,
      keyCode,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit),
  );
}

describe("Emacs region case commands", () => {
  it("C-x C-l lower-cases the region", () => {
    const target = regionView("Řeka ÚSTÍ");
    ctrl(target, "x", 88);
    ctrl(target, "l", 76);
    expect(target.state.doc.toString()).toBe("řeka ústí");
  });

  it("C-x C-u still upper-cases the region", () => {
    const target = regionView("Řeka ústí");
    ctrl(target, "x", 88);
    ctrl(target, "u", 85);
    expect(target.state.doc.toString()).toBe("ŘEKA ÚSTÍ");
  });
});
