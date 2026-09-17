// @vitest-environment jsdom

import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import type { CompletionSource } from "@codemirror/autocomplete";
import { getCM, Vim } from "@replit/codemirror-vim";
import type { CodeMirrorV } from "@replit/codemirror-vim";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import {
  CodeMirrorEditor,
  isBibtexSourcePath,
  isLatexSourcePath,
  isProseSourcePath,
  type EditorHost,
} from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import {
  englishEditorMessage,
  installEnglishEditorMessages,
} from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

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
      t: englishEditorMessage,
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n",
      setContent: vi.fn(),
      useSettings: () => ({
        keymap: "default",
        tabSize: 4,
        lineWrap: true,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: true,
        autoCloseBrackets: true,
        nonBlinkingCursor: false,
        ghostCompletion: true,
      stickyScroll: false,
      mathPreview: false,
      }),
      useVisualMode: () => false,
      useEditorKeymap: () => ({}),
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
      t: englishEditorMessage,
      useActivePath: () => "main.typ",
      getActivePath: () => "main.typ",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "@alp",
      setContent: vi.fn(),
      useSettings: () => ({
        keymap: "default",
        tabSize: 4,
        lineWrap: true,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: true,
        nonBlinkingCursor: false,
        ghostCompletion: true,
      stickyScroll: false,
      mathPreview: false,
      }),
      useVisualMode: () => false,
      useEditorKeymap: () => ({}),
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

describe("CodeMirrorEditor Vim integration", () => {
  function host(saveActive = vi.fn()): EditorHost {
    return {
      t: englishEditorMessage,
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "first line\nsecond line\n",
      setContent: vi.fn(),
      saveActive,
      useSettings: () => ({
        keymap: "vim",
        tabSize: 4,
        lineWrap: true,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
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

  it("shows the active mode and keeps ordinary keymaps behind Vim", () => {
    render(createElement(CodeMirrorEditor, { host: host() }));
    const view = getEditorView();
    expect(view).not.toBeNull();
    expect(document.querySelector(".cm-vim-panel")).toHaveTextContent("NORMAL");

    const original = view!.state.doc.toString();
    fireEvent.keyDown(view!.contentDOM, { key: "l", code: "KeyL" });
    fireEvent.keyDown(view!.contentDOM, {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      which: 8,
    });
    expect(view!.state.doc.toString()).toBe(original);

    const tabWasNotCanceled = fireEvent.keyDown(view!.contentDOM, {
      key: "Tab",
      code: "Tab",
    });
    expect(view!.state.doc.toString()).toBe(original);
    expect(tabWasNotCanceled).toBe(true);

    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD" });
    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD" });
    expect(view!.state.doc.toString()).toBe("second line\n");
    fireEvent.keyDown(view!.contentDOM, { key: "u", code: "KeyU" });
    expect(view!.state.doc.toString()).toBe(original);
    fireEvent.keyDown(view!.contentDOM, {
      key: "y",
      code: "KeyY",
      ctrlKey: true,
    });
    expect(view!.state.doc.toString()).toBe(original);

    fireEvent.keyDown(view!.contentDOM, { key: "i", code: "KeyI" });
    expect(document.querySelector(".cm-vim-panel")).toHaveTextContent("INSERT");
    fireEvent.keyDown(view!.contentDOM, { key: "Escape", code: "Escape" });
    expect(document.querySelector(".cm-vim-panel")).toHaveTextContent("NORMAL");
  });

  it("routes the platform undo and redo chords through Vim", () => {
    render(createElement(CodeMirrorEditor, { host: host() }));
    const view = getEditorView();
    const original = view!.state.doc.toString();
    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD" });
    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD" });
    expect(view!.state.doc.toString()).toBe("second line\n");

    fireEvent.keyDown(view!.contentDOM, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(view!.state.doc.toString()).toBe(original);
    fireEvent.keyDown(view!.contentDOM, {
      key: "Z",
      code: "KeyZ",
      keyCode: 90,
      which: 90,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(view!.state.doc.toString()).toBe("second line\n");
    expect(document.querySelector(".cm-vim-panel")).toHaveTextContent("NORMAL");
  });

  it("routes :w to the editor host's explicit save", () => {
    const saveActive = vi.fn();
    render(createElement(CodeMirrorEditor, { host: host(saveActive) }));
    const view = getEditorView();
    const cm = view ? getCM(view) : null;
    expect(cm).not.toBeNull();

    Vim.handleEx(cm! as CodeMirrorV, "w");

    expect(saveActive).toHaveBeenCalledOnce();
  });
});


it("blocks document commands during a mutation while allowing authoritative synchronization", async () => {
  let locked = false;
  let content = "Before";
  let owner: { setLocked: (locked: boolean) => void; reconcile: () => void } | undefined;
  const setContent = vi.fn();
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => "notes.txt",
    getActivePath: () => "notes.txt",
    useDocVersion: () => 0,
    useCompletionSyntax: () => "generic",
    getContent: () => content,
    setContent,
    isEditLocked: () => locked,
    registerMutationOwner: (value) => { owner = value; return () => {}; },
    useSettings: () => ({ keymap: "default", tabSize: 4, lineWrap: true, spellcheck: false, harper: false, editorTheme: "system", autocomplete: false, autoCloseBrackets: false, nonBlinkingCursor: false, ghostCompletion: false, stickyScroll: false, mathPreview: false }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
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

describe("CodeMirrorEditor keybinding modes and layout preferences", () => {
  function settingsHost(
    overrides: Partial<ReturnType<EditorHost["useSettings"]>> = {},
    editorKeys: Record<string, string> = {},
    saveActive = vi.fn(),
  ): EditorHost {
    return {
      t: englishEditorMessage,
      useActivePath: () => "main.tex",
      getActivePath: () => "main.tex",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "latex",
      getContent: () => "alpha beta\nsecond line\n",
      setContent: vi.fn(),
      saveActive,
      useSettings: () => ({
        keymap: "default",
        tabSize: 4,
        lineWrap: true,
        spellcheck: false,
        harper: false,
        editorTheme: "system",
        autocomplete: false,
        autoCloseBrackets: false,
        nonBlinkingCursor: false,
        ghostCompletion: false,
        stickyScroll: false,
        mathPreview: false,
        ...overrides,
      }),
      useVisualMode: () => false,
      useEditorKeymap: () => editorKeys,
      useLintRefreshDeps: () => [],
    };
  }

  it("applies the tab size to both the indent unit and the rendered tab width", () => {
    const mounted = render(createElement(CodeMirrorEditor, { host: settingsHost({ tabSize: 2 }) }));
    const view = getEditorView();
    expect(view!.state.tabSize).toBe(2);
    expect(view!.state.facet(indentUnit)).toBe("  ");
    mounted.unmount();
  });

  it("drops the wrapping class when line wrapping is off", () => {
    const wrapped = render(createElement(CodeMirrorEditor, { host: settingsHost() }));
    expect(getEditorView()!.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    wrapped.unmount();

    const unwrapped = render(
      createElement(CodeMirrorEditor, { host: settingsHost({ lineWrap: false }) }),
    );
    expect(getEditorView()!.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
    unwrapped.unmount();
  });

  it("runs a remapped editor key ahead of CodeMirror's own binding for that chord", () => {
    const mounted = render(
      createElement(CodeMirrorEditor, {
        host: settingsHost({}, { deleteLine: "Mod-d", uppercase: "Ctrl-u" }),
      }),
    );
    const view = getEditorView();
    view!.dispatch({ selection: { anchor: 3 } });
    fireEvent.keyDown(view!.contentDOM, { key: "u", code: "KeyU", keyCode: 85, ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("ALPHA beta\nsecond line\n");

    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD", keyCode: 68, ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("second line\n");
    mounted.unmount();
  });

  it("leaves a chord to CodeMirror when the action is unbound", () => {
    const mounted = render(
      createElement(CodeMirrorEditor, { host: settingsHost({}, { deleteLine: "" }) }),
    );
    const view = getEditorView();
    view!.dispatch({ selection: { anchor: 3 } });
    fireEvent.keyDown(view!.contentDOM, { key: "d", code: "KeyD", keyCode: 68, ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("alpha beta\nsecond line\n");
    mounted.unmount();
  });

  it("loads Emacs mode with visual line movement, no Vim panel, and C-x C-s saving", () => {
    const saveActive = vi.fn();
    const mounted = render(
      createElement(CodeMirrorEditor, {
        host: settingsHost({ keymap: "emacs" }, {}, saveActive),
      }),
    );
    const view = getEditorView();
    expect(view!.scrollDOM.classList.contains("cm-emacsMode")).toBe(true);
    expect(document.querySelector(".cm-vim-panel")).toBeNull();

    view!.dispatch({ selection: { anchor: 4 } });
    fireEvent.keyDown(view!.contentDOM, { key: "e", code: "KeyE", ctrlKey: true });
    expect(view!.state.selection.main.head).toBe(10);
    fireEvent.keyDown(view!.contentDOM, { key: "a", code: "KeyA", ctrlKey: true });
    expect(view!.state.selection.main.head).toBe(0);

    fireEvent.keyDown(view!.contentDOM, { key: "x", code: "KeyX", ctrlKey: true });
    fireEvent.keyDown(view!.contentDOM, { key: "s", code: "KeyS", ctrlKey: true });
    expect(saveActive).toHaveBeenCalledOnce();
    mounted.unmount();
  });

  it("kills to the end of the line with C-k in Emacs mode", () => {
    const mounted = render(
      createElement(CodeMirrorEditor, { host: settingsHost({ keymap: "emacs" }) }),
    );
    const view = getEditorView();
    view!.dispatch({ selection: { anchor: 5 } });
    fireEvent.keyDown(view!.contentDOM, { key: "k", code: "KeyK", ctrlKey: true });
    expect(view!.state.doc.toString()).toBe("alpha\nsecond line\n");
    mounted.unmount();
  });
});

describe("isBibtexSourcePath", () => {
  it("recognizes a bibliography database whatever its case", () => {
    expect(isBibtexSourcePath("references.bib")).toBe(true);
    expect(isBibtexSourcePath("REFERENCES.BIB")).toBe(true);
    expect(isBibtexSourcePath("main.tex")).toBe(false);
    expect(isBibtexSourcePath(null)).toBe(false);
  });
});

describe("BibTeX source tools", () => {
  const BIB = "@article{knuth84,\n  author = {K},\n  title = {T},\n  journal = {J},\n}\n";

  function bibHost(): EditorHost {
    return {
      t: englishEditorMessage,
      useActivePath: () => "refs.bib",
      getActivePath: () => "refs.bib",
      useDocVersion: () => 0,
      useCompletionSyntax: () => "bibtex",
      getContent: () => BIB,
      setContent: () => {},
      useSettings: () => ({ keymap: "default", tabSize: 2, lineWrap: true, spellcheck: false, harper: false, editorTheme: "system", autocomplete: true, autoCloseBrackets: true, nonBlinkingCursor: false, ghostCompletion: false, stickyScroll: false, mathPreview: false }),
      useVisualMode: () => false,
      useEditorKeymap: () => ({}),
      useLintRefreshDeps: () => [],
    };
  }

  it("names a missing required field without any project index", async () => {
    installEnglishEditorMessages();
    const mounted = render(createElement(CodeMirrorEditor, { host: bibHost() }));
    const view = getEditorView();
    expect(view).not.toBeNull();

    forceLinting(view!);
    await vi.waitFor(
      () => {
        const messages: string[] = [];
        forEachDiagnostic(view!.state, (found) => messages.push(found.message));
        expect(messages.some((text) => text.includes("year or date"))).toBe(true);
      },
      { timeout: 5_000, interval: 100 },
    );

    mounted.unmount();
  }, 10_000);
});
