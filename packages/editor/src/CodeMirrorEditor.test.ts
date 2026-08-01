// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import {
  CodeMirrorEditor,
  isLatexSourcePath,
  isProseSourcePath,
  type EditorHost,
} from "./CodeMirrorEditor";
import { getEditorView } from "./controller";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isLatexSourcePath", () => {
  it("keeps LaTeX-only tooling off Typst and support files", () => {
    expect(isLatexSourcePath("main.tex")).toBe(true);
    expect(isLatexSourcePath("MAIN.LATEX")).toBe(true);
    expect(isLatexSourcePath("main.typ")).toBe(false);
    expect(isLatexSourcePath("references.bib")).toBe(false);
  });
});

describe("isProseSourcePath", () => {
  it("enables prose checks for Markdown, LaTeX, and Typst", () => {
    expect(isProseSourcePath("main.md")).toBe(true);
    expect(isProseSourcePath("paper.MARKDOWN")).toBe(true);
    expect(isProseSourcePath("main.tex")).toBe(true);
    expect(isProseSourcePath("main.typ")).toBe(true);
  });
});

describe("CodeMirrorEditor measurement", () => {
  it("measures the published view on its first active mount", () => {
    // Keep animation-frame callbacks pending. That isolates the synchronous
    // layout-effect guarantee from CodeMirror's own later frame work.
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let measuredPublishedView = false;
    const originalRequestMeasure = EditorView.prototype.requestMeasure;
    vi.spyOn(EditorView.prototype, "requestMeasure").mockImplementation(
      function (this: EditorView, ...args: Parameters<EditorView["requestMeasure"]>) {
        if (getEditorView() === this) measuredPublishedView = true;
        return originalRequestMeasure.apply(this, args);
      },
    );

    const host: EditorHost = {
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useDocVersion: () => 0,
      getContent: () => "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n",
      setContent: vi.fn(),
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
      }),
      useLintRefreshDeps: () => [],
    };

    render(createElement(CodeMirrorEditor, { active: true, host }));

    expect(measuredPublishedView).toBe(true);
  });
});
