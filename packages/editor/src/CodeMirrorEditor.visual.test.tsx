// @vitest-environment jsdom

import { syntaxTree } from "@codemirror/language";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor, type EditorHost, supportsVisualMode } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { englishEditorMessage, installEnglishEditorMessages } from "./test-messages";
import { visualModeActive } from "./visual/facets";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function host(path: string, content: string): EditorHost {
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
      lineWrap: false,
      spellcheck: false,
      harper: false,
      editorTheme: "system",
      autocomplete: false,
      autoCloseBrackets: true,
      nonBlinkingCursor: false,
      ghostCompletion: false,
      stickyScroll: false,
      mathPreview: false,
    }),
    useVisualMode: () => true,
    visualPorts: { resolveImage: async () => null },
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
}

describe("visual mode gating", () => {
  it("supports visual mode for LaTeX and Typst documents only", () => {
    expect(supportsVisualMode("main.tex")).toBe(true);
    expect(supportsVisualMode("chapters/intro.typ")).toBe(true);
    expect(supportsVisualMode("notes.md")).toBe(false);
    expect(supportsVisualMode("refs.bib")).toBe(false);
    expect(supportsVisualMode(null)).toBe(false);
  });

  it("turns on the Typst visual surface over the Typst tree for a .typ file", async () => {
    installEnglishEditorMessages();
    const mounted = render(createElement(CodeMirrorEditor, { host: host("main.typ", "= Title\nBody *bold*.\n") }));
    await vi.waitFor(() => {
      const view = getEditorView();
      expect(view?.state.facet(visualModeActive)).toBe(true);
      expect(view?.dom.querySelector(".ofl-visual-typst-heading-1")).not.toBeNull();
    });
    const view = getEditorView();
    expect(syntaxTree(view!.state).type.name).toBe("Source");
    expect(view!.dom.querySelector(".ofl-visual-preamble-widget")).toBeNull();
    mounted.unmount();
  });

  it("keeps the LaTeX tree for a .tex file", async () => {
    installEnglishEditorMessages();
    const mounted = render(
      createElement(CodeMirrorEditor, {
        host: host("main.tex", "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n"),
      }),
    );
    await vi.waitFor(() => {
      expect(getEditorView()?.state.facet(visualModeActive)).toBe(true);
      expect(getEditorView()?.dom.querySelector(".ofl-visual-end-document")).not.toBeNull();
    });
    mounted.unmount();
  });
});
