// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import {
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodeMirrorEditor,
  isTypstSourcePath,
  type EditorHost,
} from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { englishEditorMessage, installEnglishEditorMessages } from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function host(path: string, content: string, autoCloseBrackets = true): EditorHost {
  return {
    t: englishEditorMessage,
    useActivePath: () => path,
    getActivePath: () => path,
    useDocVersion: () => 0,
    useCompletionSyntax: () => (path.endsWith(".typ") ? "typst" : "latex"),
    getContent: () => content,
    setContent: () => {},
    useSettings: () => ({
      keymap: "default",
      tabSize: 2,
      lineWrap: true,
      spellcheck: false,
      harper: false,
      editorTheme: "system",
      autocomplete: true,
      autoCloseBrackets,
      nonBlinkingCursor: false,
      ghostCompletion: false,
      stickyScroll: false,
      mathPreview: false,
    }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
}

function mount(path: string, content: string, autoCloseBrackets = true) {
  installEnglishEditorMessages();
  const mounted = render(
    createElement(CodeMirrorEditor, { host: host(path, content, autoCloseBrackets) }),
  );
  const view = getEditorView();
  if (!view) throw new Error("editor did not mount");
  view.dispatch({ selection: EditorSelection.cursor(content.length) });
  return { view, mounted };
}

function press(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) =>
      handler(view, from, to, text, () =>
        view.state.update({ changes: { from, to, insert: text } }),
      ),
    );
  if (!handled) view.dispatch(view.state.replaceSelection(text));
}

describe("Typst editing inside the editor component", () => {
  it("recognizes Typst sources by extension", () => {
    expect(isTypstSourcePath("chapters/intro.typ")).toBe(true);
    expect(isTypstSourcePath("MAIN.TYP")).toBe(true);
    expect(isTypstSourcePath("main.tex")).toBe(false);
    expect(isTypstSourcePath(null)).toBe(false);
  });

  it("continues lists and pairs dollars in a Typst file", () => {
    const { view, mounted } = mount("main.typ", "- first");
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("- first\n- ");
    type(view, "$");
    expect(view.state.doc.toString()).toBe("- first\n- $$");
    mounted.unmount();
  });

  it("keeps dollar pairing off when auto-closing is off", () => {
    const { view, mounted } = mount("main.typ", "Text ", false);
    type(view, "$");
    expect(view.state.doc.toString()).toBe("Text $");
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("Text $\n");
    mounted.unmount();
  });

  it("leaves Typst list markers alone in a LaTeX file", () => {
    const { view, mounted } = mount("main.tex", "- first");
    press(view, "Enter");
    expect(view.state.doc.toString()).not.toContain("\n- ");
    mounted.unmount();
  });

  it("offers the Typst slash snippets in a Typst file", async () => {
    const { view, mounted } = mount("main.typ", "Intro\n/fig");
    startCompletion(view);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain(
        "/figure",
      );
    });
    mounted.unmount();
  });
});
