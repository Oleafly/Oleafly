// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import type { CompletionSource } from "@codemirror/autocomplete";
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
      useCompletionSyntax: () => "latex",
      getContent: () => "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n",
      setContent: vi.fn(),
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: true,
        autoCloseBrackets: true,
        nonBlinkingCursor: false,
        ghostCompletion: true,
      stickyScroll: false,
      }),
      useLintRefreshDeps: () => [],
    };

    render(createElement(CodeMirrorEditor, { active: true, host }));

    expect(measuredPublishedView).toBe(true);
  });

  it("never invokes an async popup source from ghost completion", async () => {
    const asyncPopupSource = vi.fn<CompletionSource>(async () => null);
    const synchronousGhostSource = vi.fn<CompletionSource>((context) => {
      const token = context.matchBefore(/[A-Za-z]+$/u);
      return token
        ? {
            from: token.from,
            options: [{ label: `${token.text}ha` }],
          }
        : null;
    });
    const host: EditorHost = {
      useActivePath: () => "main.typ",
      getActivePath: () => "main.typ",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "@alp",
      setContent: vi.fn(),
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: true,
        nonBlinkingCursor: false,
        ghostCompletion: true,
      stickyScroll: false,
      }),
      useLintRefreshDeps: () => [],
    };

    render(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        extraCompletionSourcesForPath: () => [asyncPopupSource],
        extraGhostCompletionSourcesForPath: () => [synchronousGhostSource],
      }),
    );
    const view = getEditorView();
    expect(view).not.toBeNull();
    view?.dispatch({ selection: { anchor: view.state.doc.length } });

    await vi.waitFor(() => expect(synchronousGhostSource).toHaveBeenCalled());
    expect(asyncPopupSource).not.toHaveBeenCalled();
  });
});


it("blocks document commands during a mutation while allowing authoritative synchronization", async () => {
  let locked = false;
  let content = "Before";
  let owner: { setLocked: (locked: boolean) => void; reconcile: () => void } | undefined;
  const setContent = vi.fn();
  const host: EditorHost = {
    useActivePath: () => "notes.txt",
    getActivePath: () => "notes.txt",
    useDocVersion: () => 0,
    useCompletionSyntax: () => "generic",
    getContent: () => content,
    setContent,
    isEditLocked: () => locked,
    registerMutationOwner: (value) => { owner = value; return () => {}; },
    useSettings: () => ({ vim: false, spellcheck: false, harper: false, editorTheme: "system", autocomplete: false, autoCloseBrackets: false, nonBlinkingCursor: false, ghostCompletion: false, stickyScroll: false }),
    useLintRefreshDeps: () => [],
  };
  const mounted = render(createElement(CodeMirrorEditor, { host }));
  const view = getEditorView();
  expect(view).not.toBeNull();
  locked = true;
  owner?.setLocked(true);
  view!.dispatch({ changes: { from: 0, insert: "Blocked" } });
  expect(view!.state.doc.toString()).toBe("Before");
  expect(setContent).not.toHaveBeenCalled();
  content = "Applied";
  owner?.reconcile();
  expect(view!.state.doc.toString()).toBe("Applied");
  await Promise.resolve();
  locked = false;
  owner?.setLocked(false);
  view!.dispatch({ changes: { from: 7, insert: " edit" } });
  expect(setContent).toHaveBeenLastCalledWith("notes.txt", "Applied edit");
  mounted.unmount();
});
