// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { liveMathPreview } from "./math-preview";

let view: EditorView | null = null;

beforeEach(() => {
  // The preview paints once its host is on screen. jsdom has no
  // IntersectionObserver, so the module falls back to a timer.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  view = null;
});

const DOC = "Let $n$ be the count.\n";

function mount(doc = DOC) {
  const editor = new EditorView({
    state: EditorState.create({ doc, extensions: [liveMathPreview("latex")] }),
    parent: document.body,
  });
  view = editor;
  return editor;
}

/** Runs the debounce that builds decorations, then the deferred first paint. */
function settle() {
  vi.advanceTimersByTime(250);
}

function preview(editor: EditorView): HTMLElement | null {
  return editor.dom.querySelector(".math-preview");
}

describe("live math preview", () => {
  it("paints KaTeX in the widget's first frame without a resizing placeholder", () => {
    const editor = mount();
    vi.advanceTimersByTime(0);

    const host = preview(editor);
    expect(host).not.toBeNull();
    expect(host!.querySelector(".math-preview-loading")).toBeNull();
    expect(host!.querySelector(".katex")).not.toBeNull();
  });

  it("renders the expression rather than staying on the loading label", () => {
    const editor = mount();
    settle();

    const host = preview(editor);
    expect(host).not.toBeNull();
    expect(host!.querySelector(".math-preview-loading")).toBeNull();
  });

  it("keeps display previews out of CodeMirror's virtual block geometry", () => {
    const editor = mount("Before\n\\[\n  x^2 + y^2\n\\]\nAfter\n");
    settle();

    const host = preview(editor);
    expect(host).not.toBeNull();
    expect(host!.tagName).toBe("SPAN");
    expect(host).toHaveClass("is-display");
    expect(editor.dom.querySelector(".cm-blockWidget")).toBeNull();
  });

  it("keeps painting across edits", () => {
    const editor = mount();
    settle();
    editor.dispatch({ changes: { from: 0, insert: "Note: " } });
    settle();

    const host = preview(editor);
    expect(host).not.toBeNull();
    expect(host!.querySelector(".math-preview-loading")).toBeNull();
  });

  it("does not silently omit visible expressions after an arbitrary count", () => {
    const expressions = Array.from(
      { length: 96 },
      (_, index) => `$x_${index}$`,
    ).join(" ");
    const editor = mount(expressions);
    settle();

    expect(
      editor.dom.querySelectorAll(".math-preview"),
    ).toHaveLength(96);
  });
});
