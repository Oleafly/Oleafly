// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Extension, EditorState } from "@codemirror/state";
import {
  type DecorationSet,
  EditorView,
  type ViewPlugin,
  type WidgetType,
} from "@codemirror/view";
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

  it("keeps unaffected preview DOM mounted throughout the edit debounce", () => {
    const editor = mount("Before $x$ and $y$ after.\n");
    settle();
    const before = [...editor.dom.querySelectorAll(".math-preview")];
    expect(before).toHaveLength(2);

    editor.dispatch({ changes: { from: 0, insert: "Note: " } });

    const duringDebounce = [...editor.dom.querySelectorAll(".math-preview")];
    expect(duringDebounce).toHaveLength(2);
    expect(duringDebounce[0]).toBe(before[0]);
    expect(duringDebounce[1]).toBe(before[1]);

    settle();
    const afterRefresh = [...editor.dom.querySelectorAll(".math-preview")];
    expect(afterRefresh).toHaveLength(2);
    expect(afterRefresh[0]).toBe(before[0]);
    expect(afterRefresh[1]).toBe(before[1]);
  });

  it("replaces only the preview whose expression was edited", () => {
    const editor = mount("Before $x$ and $y$ after.\n");
    settle();
    const before = [...editor.dom.querySelectorAll(".math-preview")];
    const firstExpression = editor.state.doc.toString().indexOf("$x$") + 2;

    editor.dispatch({
      changes: { from: firstExpression, to: firstExpression, insert: "^2" },
    });
    const duringDebounce = [...editor.dom.querySelectorAll(".math-preview")];
    expect(duringDebounce[0]).toBe(before[0]);
    expect(duringDebounce[1]).toBe(before[1]);

    settle();
    const afterRefresh = [...editor.dom.querySelectorAll(".math-preview")];
    expect(afterRefresh).toHaveLength(2);
    expect(afterRefresh[0]).not.toBe(before[0]);
    expect(afterRefresh[1]).toBe(before[1]);
  });

  it("can remount a retained widget after a later document revision", () => {
    const extension = liveMathPreview("latex") as readonly Extension[];
    const previewPlugin = extension[1] as ViewPlugin<{
      decorations: DecorationSet;
    }>;
    const editor = new EditorView({
      state: EditorState.create({
        doc: "Before $x$ after.\n",
        extensions: [extension],
      }),
      parent: document.body,
    });
    view = editor;
    settle();

    let retainedWidget: WidgetType | null = null;
    editor
      .plugin(previewPlugin)
      ?.decorations.between(0, editor.state.doc.length, (_from, _to, value) => {
        if (value.spec.widget) retainedWidget = value.spec.widget;
      });
    expect(retainedWidget).not.toBeNull();

    editor.dispatch({ changes: { from: 0, insert: "Note: " } });
    settle();

    // CodeMirror can retain an equal WidgetType after a decoration refresh,
    // destroy its offscreen DOM, and ask that older instance toDOM() again
    // when it returns to the virtual viewport.
    const remounted = retainedWidget!.toDOM(editor);
    expect(remounted.querySelector(".math-preview-loading")).toBeNull();
    expect(remounted.querySelector(".katex")).not.toBeNull();
    retainedWidget!.destroy(remounted);
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
