// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { englishEditorMessage } from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

interface HostState {
  content: string;
  locked: boolean;
}

afterEach(() => cleanup());

async function mountEditor(locked: boolean) {
  const store = create<HostState>(() => ({ content: "Hello", locked }));
  let owner: { setLocked: (locked: boolean) => void } | null = null;
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => "main.tex",
    getActivePath: () => "main.tex",
    useDocVersion: () => 0,
    useCompletionSyntax: () => "latex",
    getContent: () => store.getState().content,
    setContent: (_path, content) => store.setState({ content }),
    isEditLocked: () => store.getState().locked,
    useEditLocked: () => store((s) => s.locked),
    registerMutationOwner: (next) => {
      owner = next;
      return () => {
        owner = null;
      };
    },
    useSettings: () => ({
      keymap: "default", tabSize: 2, lineWrap: true, spellcheck: false, harper: false,
      editorTheme: "system", autocomplete: false, autoCloseBrackets: false,
      cursorBlinking: "blink", highlightCurrentLine: true, cursorHeight: "text", ghostCompletion: false, stickyScroll: false, mathPreview: false,
    }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
  render(createElement(CodeMirrorEditor, { active: true, host }));
  await act(async () => {});
  return {
    store,
    releaseLease: () => owner?.setLocked(false),
  };
}

function view() {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

describe("host edit lock", () => {
  it("makes the editor read-only as soon as the host reports a lock", async () => {
    const { store } = await mountEditor(false);
    expect(view().state.readOnly).toBe(false);

    await act(async () => store.setState({ locked: true }));

    expect(view().state.readOnly).toBe(true);
    expect(view().contentDOM.getAttribute("contenteditable")).toBe("false");
  });

  it("makes the editor editable again when the host lock clears", async () => {
    const { store } = await mountEditor(true);
    expect(view().state.readOnly).toBe(true);

    await act(async () => store.setState({ locked: false }));

    expect(view().state.readOnly).toBe(false);
    expect(view().contentDOM.getAttribute("contenteditable")).toBe("true");
  });

  it("keeps a host lock when a mutation lease is released", async () => {
    const { releaseLease } = await mountEditor(true);

    act(() => releaseLease());

    expect(view().state.readOnly).toBe(true);
  });
});
