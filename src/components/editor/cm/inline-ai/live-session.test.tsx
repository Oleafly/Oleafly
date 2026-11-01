// @vitest-environment jsdom
import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { type EditorMessageKey, getEditorView } from "@oleafly/editor";
import { CodeMirrorEditor, type EditorHost } from "@oleafly/editor/CodeMirrorEditor";
import { LocalDocumentSession } from "@oleafly/editor/document-session";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { useInlineEditStore } from "@/store/inlineEdit";

vi.mock("./InlineEditPanel", () => ({ InlineEditPanel: () => null }));

import { acceptInlineEdit, inlineDiffPlugin } from "./plugin";
import { stubRangeGeometry } from "../../../../../packages/editor/src/test-geometry";

stubRangeGeometry();

const SETTINGS: ReturnType<EditorHost["useSettings"]> = {
  keymap: "default",
  tabSize: 2,
  lineWrap: true,
  spellcheck: false,
  harper: false,
  editorTheme: "system",
  autocomplete: false,
  autoCloseBrackets: false,
  cursorBlinking: "blink",
  highlightCurrentLine: true,
  cursorHeight: "text",
  ghostCompletion: false,
  stickyScroll: false,
  mathPreview: false,
};

const MAIN = "hello world\nsecond line";

let unmount: (() => void) | null = null;
let shared: LocalDocumentSession;
let activePath: (path: string) => Promise<void>;

function editorView() {
  const view = getEditorView();
  if (!view) throw new Error("The editor did not mount.");
  return view;
}

function session() {
  return useInlineEditStore.getState().session;
}

async function remote(from: number, to: number, insert: string) {
  await act(async () => shared.pushRemote([{ from, to, insert }]));
}

beforeEach(async () => {
  useInlineEditStore.getState().reset();
  shared = new LocalDocumentSession("main.tex", MAIN);
  const store = create(() => ({
    activePath: "main.tex" as string | null,
    files: { "main.tex": MAIN, "chapter.tex": "chapter text" } as Record<string, string>,
  }));
  const host: EditorHost = {
    t: testCatalogTranslator<EditorMessageKey>("editor"),
    useActivePath: () => store((state) => state.activePath),
    getActivePath: () => store.getState().activePath,
    useDocVersion: () => 0,
    useCompletionSyntax: () => "latex",
    getContent: (path) => store.getState().files[path] ?? "",
    setContent: () => {},
    documentSession: (path) => (path === "main.tex" ? shared : null),
    useSettings: () => SETTINGS,
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
  activePath = async (path) => {
    await act(async () => store.setState({ activePath: path }));
  };
  unmount = render(
    createElement(CodeMirrorEditor, { active: true, host, extraExtensions: [inlineDiffPlugin] }),
  ).unmount;
  await act(async () => {});
  act(() => useInlineEditStore.getState().open({ from: 6, to: 11, original: "world" }));
  act(() => {
    useInlineEditStore.getState().startStreaming();
    useInlineEditStore.getState().appendProposed("there");
    useInlineEditStore.getState().finishReviewing();
  });
});

afterEach(() => {
  unmount?.();
  unmount = null;
  useInlineEditStore.getState().reset();
});

describe("a pending inline AI suggestion in a shared file", () => {
  it("follows a collaborator's edit before it and accepts onto the right text", async () => {
    await remote(0, 0, "Oh, ");
    expect(session()).toMatchObject({ phase: "reviewing", from: 10, to: 15 });
    act(() => acceptInlineEdit(editorView()));
    expect(editorView().state.doc.toString()).toBe("Oh, hello there\nsecond line");
    expect(shared.text()).toBe("Oh, hello there\nsecond line");
  });

  it("is withdrawn when a collaborator edits the text it would replace", async () => {
    await remote(8, 9, "R");
    expect(session()?.phase).toBe("withdrawn");
    act(() => acceptInlineEdit(editorView()));
    expect(shared.text()).toBe("hello woRld\nsecond line");
  });

  it("closes instead of landing in another file", async () => {
    await activePath("chapter.tex");
    expect(session()).toBeNull();
    act(() => acceptInlineEdit(editorView()));
    expect(editorView().state.doc.toString()).toBe("chapter text");
  });
});
