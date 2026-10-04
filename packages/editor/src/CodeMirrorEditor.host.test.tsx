// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { getEditorDocumentPath, getEditorView } from "./controller";
import { setSpellHost } from "./spellcheck";
import { englishEditorMessage } from "./test-messages";
import { isMathPreviewEnabled, setMathPreviewEnabled } from "./visual/math-preview";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

type Settings = ReturnType<EditorHost["useSettings"]>;

interface HostState {
  path: string | null;
  files: Record<string, string>;
  settings: Settings;
  version: number;
}

const SETTINGS: Settings = {
  keymap: "default",
  tabSize: 2,
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
};

const cancelProofreading = vi.fn();

afterEach(() => {
  cleanup();
  cancelProofreading.mockReset();
});

function installSpellHost(): void {
  setSpellHost({
    t: englishEditorMessage,
    getProjectId: () => "project",
    getActivePath: () => "main.tex",
    getLintPrefs: () => ({ showRegionalism: false, showWordChoice: false }),
    isSessionIgnored: () => false,
    isWordIgnored: () => false,
    ignoreWordForProject: () => undefined,
    ignoreWordGlobally: () => undefined,
    cancelProofreading,
  });
}

async function mountEditor(initial: Partial<HostState> = {}, setMathPreview = vi.fn(), active = true) {
  installSpellHost();
  const store = create<HostState>(() => ({
    path: "main.tex",
    files: { "main.tex": "\\section{One}\nText", "paper.typ": "= One\nText", "notes.md": "# One\n$x$" },
    settings: SETTINGS,
    version: 0,
    ...initial,
  }));
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => store((state) => state.path),
    getActivePath: () => store.getState().path,
    useDocVersion: () => store((state) => state.version),
    useCompletionSyntax: () => "latex",
    getContent: (path) => store.getState().files[path] ?? "",
    setContent: (path, content) => store.setState((state) => ({ files: { ...state.files, [path]: content } })),
    useSettings: () => store((state) => state.settings),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
    setMathPreview,
  };
  render(createElement(CodeMirrorEditor, { active, host }));
  await act(async () => {});
  return store;
}

function view() {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

function settings(store: Awaited<ReturnType<typeof mountEditor>>, next: Partial<Settings>) {
  return act(async () => store.setState((state) => ({ settings: { ...state.settings, ...next } })));
}

describe("CodeMirrorEditor document lifecycle", () => {
  it("clears the document and forgets its path when no file is active", async () => {
    const store = await mountEditor();
    expect(getEditorDocumentPath()).toBe("main.tex");
    await act(async () => store.setState({ path: null }));
    expect(view().state.doc.toString()).toBe("");
    expect(getEditorDocumentPath()).toBeNull();
    expect(cancelProofreading).toHaveBeenCalledWith("source", "main.tex");
    await act(async () => store.setState({ path: "paper.typ" }));
    expect(view().state.doc.toString()).toBe("= One\nText");
    expect(getEditorDocumentPath()).toBe("paper.typ");
  });

  it("writes edits back to the host for the active file", async () => {
    const store = await mountEditor();
    await act(async () => view().dispatch({ changes: { from: view().state.doc.length, insert: "!" } }));
    expect(store.getState().files["main.tex"]).toBe("\\section{One}\nText!");
  });
});

describe("CodeMirrorEditor activity", () => {
  it("marks an inactive editor on its host element", async () => {
    await mountEditor({}, vi.fn(), false);
    expect(document.querySelector("[data-editor-active]")?.getAttribute("data-editor-active")).toBe("false");
  });
});

describe("CodeMirrorEditor settings", () => {
  it("shows sticky scroll for LaTeX and Typst sources but not for Markdown", async () => {
    const store = await mountEditor({ settings: { ...SETTINGS, stickyScroll: true } });
    expect(view().dom.querySelector(".cm-stickyScroll")).not.toBeNull();
    await act(async () => store.setState({ path: "paper.typ" }));
    expect(view().dom.querySelector(".cm-stickyScroll")).not.toBeNull();
    await act(async () => store.setState({ path: "notes.md" }));
    expect(view().dom.querySelector(".cm-stickyScroll")).toBeNull();
    await act(async () => store.setState({ path: "main.tex" }));
    await settings(store, { stickyScroll: false });
    expect(view().dom.querySelector(".cm-stickyScroll")).toBeNull();
  });

  it("enables the math preview for Markdown and reports preview toggles to the host", async () => {
    const setMathPreview = vi.fn();
    const store = await mountEditor({ path: "notes.md", settings: { ...SETTINGS, mathPreview: true } }, setMathPreview);
    expect(isMathPreviewEnabled(view().state)).toBe(true);
    await act(async () => view().dispatch({ effects: setMathPreviewEnabled.of(false) }));
    expect(setMathPreview).toHaveBeenCalledWith(false);
    await settings(store, { mathPreview: false });
    expect(isMathPreviewEnabled(view().state)).toBe(false);
  });

  it("cancels proofreading when both proofreading providers are turned off", async () => {
    const store = await mountEditor({ settings: { ...SETTINGS, spellcheck: true } });
    cancelProofreading.mockReset();
    await settings(store, { spellcheck: false });
    expect(cancelProofreading).toHaveBeenCalledWith("source", "main.tex");
  });

  it("applies tab size, keymap and cursor preferences without remounting", async () => {
    const store = await mountEditor();
    const mounted = view();
    await settings(store, { tabSize: 4, keymap: "emacs", nonBlinkingCursor: true, autoCloseBrackets: true });
    expect(view()).toBe(mounted);
    expect(view().state.tabSize).toBe(4);
    await settings(store, { keymap: "default" });
    expect(view()).toBe(mounted);
  });
});

describe("CodeMirrorEditor proofreading events", () => {
  it("cancels proofreading when the settings event turns every provider off", async () => {
    await mountEditor();
    cancelProofreading.mockReset();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("oleafly:proofreading-settings-changed", { detail: { spellcheck: false, harper: false } }),
      );
    });
    expect(cancelProofreading).toHaveBeenCalledWith("source", undefined);
  });

  it("re-lints instead of cancelling when a provider stays on", async () => {
    await mountEditor();
    cancelProofreading.mockReset();
    const dispatch = vi.spyOn(view(), "dispatch");
    act(() => {
      window.dispatchEvent(new CustomEvent("oleafly:proofreading-settings-changed", { detail: { spellcheck: true } }));
    });
    expect(cancelProofreading).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
  });

  it("re-lints for a presentation change", async () => {
    await mountEditor();
    const dispatch = vi.spyOn(view(), "dispatch");
    act(() => {
      window.dispatchEvent(new CustomEvent("oleafly:proofreading-presentation-changed"));
    });
    expect(dispatch).toHaveBeenCalled();
  });
});
