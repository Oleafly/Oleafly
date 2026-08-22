// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { CompletionSource } from "@codemirror/autocomplete";
import {
  CodeMirrorEditor,
  isLatexSourcePath,
  isProseSourcePath,
  type EditorHost,
} from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import type { DocumentChangeListener, DocumentSession } from "./document-session";
import type { FileId } from "@oleafly/realtime-protocol";

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

describe("CodeMirrorEditor DocumentSession binding", () => {
  it("sends minimal local edits and applies remote edits without feedback", async () => {
    const listener: { current: DocumentChangeListener | null } = { current: null };
    const apply = vi.fn(() => "shared:1");
    const session: DocumentSession = {
      documentId: "0198cf35-0000-7000-8000-000000000002" as FileId,
      mode: "shared",
      snapshot: () => ({ text: "hello", version: 0 }),
      apply,
      subscribe: (next) => {
        listener.current = next;
        return () => {
          listener.current = null;
        };
      },
      undo: vi.fn(),
      redo: vi.fn(),
      stopCapturing: vi.fn(),
      captureLocalRevision: vi.fn(),
      flushMaterialization: vi.fn(),
    };
    const setContent = vi.fn();
    const host: EditorHost = {
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "stale controlled value",
      setContent,
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
        nonBlinkingCursor: false,
        ghostCompletion: false,
      }),
      useLintRefreshDeps: () => [],
    };
    render(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        getDocumentSession: () => session,
      }),
    );
    const view = getEditorView();
    expect(view?.state.doc.toString()).toBe("hello");
    await Promise.resolve();

    view?.dispatch({ changes: { from: 1, to: 5, insert: "i" } });
    expect(apply).toHaveBeenCalledWith(
      [{ from: 1, to: 5, insert: "i" }],
      { origin: "human" },
    );
    expect(setContent).not.toHaveBeenCalled();

    listener.current?.({
      transactionId: "remote:1",
      source: "remote",
      edits: [{ from: 0, to: 0, insert: "A" }],
      snapshot: { text: "Ahi", version: 1 },
    });
    expect(view?.state.doc.toString()).toBe("Ahi");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending shared file read-only and never falls back to the solo host", () => {
    const setContent = vi.fn();
    const host: EditorHost = {
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useProjectId: () => "shared-local-project",
      getProjectId: () => "shared-local-project",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "local staging text",
      setContent,
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
        nonBlinkingCursor: false,
        ghostCompletion: false,
      }),
      useLintRefreshDeps: () => [],
    };
    const rendered = render(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        getDocumentAccess: () => ({
          kind: "shared" as const,
          session: null,
          message: "Downloading and saving the shared file...",
        }),
      }),
    );
    const view = getEditorView();
    expect(view?.state.facet(EditorState.readOnly)).toBe(true);
    expect(view?.state.facet(EditorView.editable)).toBe(false);
    view?.dispatch({ changes: { from: 0, insert: "blocked" } });
    expect(setContent).not.toHaveBeenCalled();
    expect(rendered.getByTestId("shared-source-readonly").textContent).toContain(
      "Downloading and saving",
    );
  });

  it("cancels a delayed cursor publish when the project and file switch", async () => {
    let projectId = "project-a";
    let path = "main.tex";
    const selectionA = vi.fn();
    const selectionB = vi.fn();
    const makeSession = (
      documentId: FileId,
      updateLocalSelection: DocumentSession["updateLocalSelection"],
    ): DocumentSession => ({
      documentId,
      mode: "shared",
      snapshot: () => ({ text: "abcdef", version: 0 }),
      apply: vi.fn(() => "shared:1"),
      subscribe: () => () => {},
      undo: vi.fn(),
      redo: vi.fn(),
      stopCapturing: vi.fn(),
      captureLocalRevision: vi.fn(),
      flushMaterialization: vi.fn(),
      updateLocalSelection,
    });
    const sessionA = makeSession(
      "0198cf35-0000-7000-8000-000000000002" as FileId,
      selectionA,
    );
    const sessionB = makeSession(
      "0198cf35-0000-7000-8000-000000000003" as FileId,
      selectionB,
    );
    const host: EditorHost = {
      useActivePath: () => path,
      getActivePath: () => path,
      useProjectId: () => projectId,
      getProjectId: () => projectId,
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "abcdef",
      setContent: vi.fn(),
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
        nonBlinkingCursor: false,
        ghostCompletion: false,
      }),
      useLintRefreshDeps: () => [],
    };
    const access = (_project: string | null, activePath: string) => ({
      kind: "shared" as const,
      session: activePath === "main.tex" ? sessionA : sessionB,
      message: "",
    });
    const rendered = render(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        getDocumentAccess: access,
      }),
    );
    getEditorView()?.dispatch({ selection: { anchor: 1, head: 4 } });
    projectId = "project-b";
    path = "other.tex";
    rendered.rerender(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        getDocumentAccess: access,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(selectionA).toHaveBeenCalledWith(null, null);
    expect(selectionA).not.toHaveBeenCalledWith(1, 4);
    expect(selectionB).not.toHaveBeenCalledWith(1, 4);
  });

  it("renders the collaborator's exact range and cursor label", () => {
    const session: DocumentSession = {
      documentId: "0198cf35-0000-7000-8000-000000000002" as FileId,
      mode: "shared",
      snapshot: () => ({ text: "hello", version: 0 }),
      apply: vi.fn(() => "shared:1"),
      subscribe: () => () => {},
      undo: vi.fn(),
      redo: vi.fn(),
      stopCapturing: vi.fn(),
      captureLocalRevision: vi.fn(),
      flushMaterialization: vi.fn(),
      collaborators: () => [
        {
          actorId: "actor-b",
          replicaId: "replica-b",
          displayName: "Bob",
          colorToken: "sky",
          anchor: 1,
          head: 4,
        },
      ],
      subscribeCollaborators: () => () => {},
    };
    const host: EditorHost = {
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useProjectId: () => "project-a",
      getProjectId: () => "project-a",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "stale",
      setContent: vi.fn(),
      useSettings: () => ({
        vim: false,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
        nonBlinkingCursor: false,
        ghostCompletion: false,
      }),
      useLintRefreshDeps: () => [],
    };
    const rendered = render(
      createElement(CodeMirrorEditor, {
        active: true,
        host,
        getDocumentAccess: () => ({ kind: "shared" as const, session, message: "" }),
      }),
    );
    expect(rendered.container.querySelector(".cm-collaborator-selection")?.textContent).toBe(
      "ell",
    );
    expect(rendered.container.querySelector(".cm-collaborator-label")?.textContent).toBe(
      "Bob",
    );
  });
});
