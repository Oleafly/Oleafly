// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const core = vi.hoisted(() => ({
  setEditorView: vi.fn(),
  getEditorView: vi.fn(),
  getCurrentLine: vi.fn(),
  gotoLine: vi.fn(),
  selectWordNearLine: vi.fn(),
  gotoRange: vi.fn(),
  insertAtCursor: vi.fn(),
  replaceRange: vi.fn(),
  wrapSelection: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
  insertTemplate: vi.fn(),
  insertEnvironment: vi.fn(),
  focusEditor: vi.fn(),
  editorUndo: vi.fn(),
  editorRedo: vi.fn(),
  editorFind: vi.fn(),
}));

vi.mock("@oleafly/editor", () => core);

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ bumpDocVersion: bumpDocVersion }) },
}));

const bumpDocVersion = vi.fn();

import {
  setWysiwygEditor,
  setWysiwygVisible,
} from "@/components/editor/wysiwyg/controller";
import {
  insertAtCursor,
  wrapSelectionOrPlaceholder,
  insertTemplate,
  insertEnvironment,
  editorUndo,
  editorRedo,
} from "./controller";

function fakeWysiwygEditor() {
  const insertContent = vi.fn().mockReturnThis();
  const focus = vi.fn().mockReturnThis();
  const run = vi.fn();
  const chain = vi.fn(() => ({ focus, insertContent, run }));
  return { chain, focus, insertContent, run };
}

describe("cm/controller mode-aware routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWysiwygEditor(null);
    setWysiwygVisible(false);
  });

  it("falls through to the CodeMirror core when wysiwyg is not active", () => {
    insertAtCursor("\\alpha");
    expect(core.insertAtCursor).toHaveBeenCalledWith("\\alpha");

    wrapSelectionOrPlaceholder("\\textbf{", "}", "text");
    expect(core.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\textbf{", "}", "text");

    insertTemplate("\\frac{a}{b}", 6, 7);
    expect(core.insertTemplate).toHaveBeenCalledWith("\\frac{a}{b}", 6, 7);

    insertEnvironment("align");
    expect(core.insertEnvironment).toHaveBeenCalledWith("align");
  });

  it("inserts a rawInline node into the wysiwyg editor instead of CodeMirror when active", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertAtCursor("\\alpha");

    expect(editor.chain).toHaveBeenCalled();
    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "rawInline",
      attrs: { source: "\\alpha" },
    });
    expect(core.insertAtCursor).not.toHaveBeenCalled();
  });

  it("inserts a rawBlock node for multi-line templates", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertTemplate("\\begin{figure}\n\\end{figure}\n", 0, 0);

    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "rawBlock",
      attrs: { source: "\\begin{figure}\n\\end{figure}\n" },
    });
    expect(core.insertTemplate).not.toHaveBeenCalled();
  });

  it("wraps the placeholder in a rawInline node for wrapSelectionOrPlaceholder", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    wrapSelectionOrPlaceholder("\\footnote{", "}", "note text");

    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "rawInline",
      attrs: { source: "\\footnote{note text}" },
    });
    expect(core.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });

  it("inserts a full environment as a rawBlock node", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertEnvironment("align");

    expect(editor.insertContent).toHaveBeenCalledWith({
      type: "rawBlock",
      attrs: { source: "\\begin{align}\n  \n\\end{align}\n" },
    });
    expect(core.insertEnvironment).not.toHaveBeenCalled();
  });

  it("falls back to CodeMirror when wysiwyg is marked active but no editor is registered", () => {
    setWysiwygVisible(true);
    insertAtCursor("\\alpha");
    expect(core.insertAtCursor).toHaveBeenCalledWith("\\alpha");
  });

  it("undo and redo call the CodeMirror core and bump the shared doc version", () => {
    editorUndo();
    expect(core.editorUndo).toHaveBeenCalledOnce();
    expect(bumpDocVersion).toHaveBeenCalledOnce();

    editorRedo();
    expect(core.editorRedo).toHaveBeenCalledOnce();
    expect(bumpDocVersion).toHaveBeenCalledTimes(2);
  });
});
