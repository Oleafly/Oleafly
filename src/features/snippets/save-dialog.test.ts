// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { loadSnippetRuntime } from "@oleafly/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ view: null as EditorView | null, files: { activePath: "main.tex" as string | null } }));

vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: () => mocks.view }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import { canSaveSelection, openSaveSnippet, useSaveSnippetDialog } from "./save-dialog";

function editor(doc: string, from: number, to: number): EditorView {
  mocks.view = new EditorView({ state: EditorState.create({ doc, selection: EditorSelection.single(from, to) }) });
  return mocks.view;
}

beforeEach(() => {
  mocks.files.activePath = "main.tex";
  useSaveSnippetDialog.getState().close();
});

afterEach(() => {
  mocks.view?.destroy();
  mocks.view = null;
});

describe("save selection as snippet", () => {
  it("opens once the editor's snippet code has loaded when it was not loaded yet", async () => {
    editor("Let $x$ be.", 5, 6);
    expect(openSaveSnippet()).toBe(true);
    await vi.waitFor(() => expect(useSaveSnippetDialog.getState().selection).toEqual({ text: "x", language: "latex", place: "math" }));
    await loadSnippetRuntime();
  });

  it("needs an editor with text selected", () => {
    expect(canSaveSelection()).toBe(false);
    expect(openSaveSnippet()).toBe(false);
    editor("hello world", 3, 3);
    expect(canSaveSelection()).toBe(false);
    editor("hello   world", 5, 8);
    expect(canSaveSelection()).toBe(false);
    expect(openSaveSnippet()).toBe(false);
    expect(useSaveSnippetDialog.getState().selection).toBeNull();
  });

  it("opens the dialog with the selection, its language and where it was", () => {
    editor("See \\caption{A map} here.", 4, 19);
    expect(canSaveSelection()).toBe(true);
    expect(openSaveSnippet()).toBe(true);
    expect(useSaveSnippetDialog.getState().selection).toEqual({ text: "\\caption{A map}", language: "latex", place: "text" });
    useSaveSnippetDialog.getState().close();
    expect(useSaveSnippetDialog.getState().selection).toBeNull();
  });

  it("reads math from the place of the selection", () => {
    editor("Let $x + \\frac{a}{b}$ be.", 9, 20);
    openSaveSnippet();
    expect(useSaveSnippetDialog.getState().selection).toMatchObject({ text: "\\frac{a}{b}", place: "math" });
    editor("\\begin{verbatim}\nraw\n\\end{verbatim}", 17, 20);
    openSaveSnippet();
    expect(useSaveSnippetDialog.getState().selection?.place).toBe("any");
  });

  it("saves from a file with no snippet language for any place", () => {
    mocks.files.activePath = "notes.txt";
    editor("plain words", 0, 5);
    openSaveSnippet();
    expect(useSaveSnippetDialog.getState().selection).toEqual({ text: "plain", language: null, place: "any" });
  });
});
