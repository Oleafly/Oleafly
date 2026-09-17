// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, serializeLatexBody } from "@oleafly/wysiwyg";

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
  editorVimUndo: vi.fn(),
  editorVimRedo: vi.fn(),
  editorFind: vi.fn(),
  waitForEditorDocument: vi.fn(),
}));

vi.mock("@oleafly/editor", () => core);

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ bumpDocVersion: bumpDocVersion }) },
}));

const bumpDocVersion = vi.fn();

import {
  setWysiwygDocumentContext,
  setWysiwygEditor,
  setWysiwygInsertions,
  setWysiwygVisible,
} from "@/components/editor/wysiwyg/controller";
import { visualInsertions } from "@/components/editor/wysiwyg/insert";
import {
  insertAtCursor,
  wrapSelectionOrPlaceholder,
  insertTemplate,
  insertEnvironment,
  editorUndo,
  editorRedo,
} from "./controller";

let editors: Editor[] = [];

function activateVisualEditor(content = "<p>Hello</p>"): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  editor.commands.setTextSelection(6);
  setWysiwygEditor(editor as never);
  setWysiwygInsertions(visualInsertions);
  setWysiwygVisible(true);
  return editor;
}

function latexOf(editor: Editor): string {
  return serializeLatexBody(editor.getJSON());
}

describe("cm/controller mode-aware routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWysiwygEditor(null);
    setWysiwygInsertions(null);
    setWysiwygVisible(false);
    setWysiwygDocumentContext(null);
  });

  afterEach(() => {
    for (const editor of editors) editor.destroy();
    editors = [];
    document.body.replaceChildren();
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

  it("keeps unknown macros as rawInline nodes with their exact source", () => {
    const editor = activateVisualEditor();
    insertAtCursor("\\alpha");
    expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({ type: "rawInline", attrs: { source: "\\alpha" } });
    expect(latexOf(editor)).toBe("Hello\\alpha\n");
    expect(core.insertAtCursor).not.toHaveBeenCalled();
  });

  it("keeps unparseable multi-line source as rawBlock nodes", () => {
    const editor = activateVisualEditor();
    insertAtCursor("\\begin{figure}\n\\end{figure}\n");
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: "rawBlock",
      attrs: { source: "\\begin{figure}\n\\end{figure}\n" },
    });
    expect(core.insertAtCursor).not.toHaveBeenCalled();
  });

  it("sends wrap, template and environment commands to the source document in both modes", () => {
    activateVisualEditor();
    wrapSelectionOrPlaceholder("\\footnote{", "}", "note text");
    expect(core.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\footnote{", "}", "note text");
    insertTemplate("$\\frac{a}{b}$", 0, 0);
    expect(core.insertTemplate).toHaveBeenCalledWith("$\\frac{a}{b}$", 0, 0);
    insertEnvironment("align");
    expect(core.insertEnvironment).toHaveBeenCalledWith("align");
  });

  it("keeps citations raw and turns delimited snippets into math", () => {
    const editor = activateVisualEditor();
    insertAtCursor("\\cite{key}");
    expect(editor.getJSON().content?.[0].content?.[1]).toEqual({
      type: "rawInline",
      attrs: { source: "\\cite{key}" },
    });
    insertAtCursor("$\\frac{numerator}{denominator}$");
    expect(editor.getJSON().content?.[0].content?.[2]).toEqual({
      type: "mathInline",
      attrs: { source: "$\\frac{numerator}{denominator}$" },
    });
  });

  it("parses figure and table source into native nodes", () => {
    const editor = activateVisualEditor();
    setWysiwygDocumentContext({ theoremEnvironments: ["observation"], booktabs: false });
    insertAtCursor(
      "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{image-filename}\n  \\caption{Caption text}\n  \\label{fig:label}\n\\end{figure}\n",
    );
    insertAtCursor("\n\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n     &   \\\\\n  \\end{tabular}\n\\end{table}\n");
    const types = editor.getJSON().content?.map((node) => node.type);
    expect(types).toContain("figure");
    expect(types).toContain("tableFloat");
    const latex = latexOf(editor);
    expect(latex).toContain("\\includegraphics[width=0.8\\textwidth]{image-filename}");
    expect(latex).toContain("\\begin{tabular}{ll}");
  });

  it("falls back to CodeMirror when wysiwyg is marked active but no editor is registered", () => {
    setWysiwygVisible(true);
    insertAtCursor("\\alpha");
    expect(core.insertAtCursor).toHaveBeenCalledWith("\\alpha");
  });

  it("undo and redo delegate to CodeMirror without rebuilding editor compartments", () => {
    editorUndo();
    expect(core.editorUndo).toHaveBeenCalledOnce();
    expect(bumpDocVersion).not.toHaveBeenCalled();

    editorRedo();
    expect(core.editorRedo).toHaveBeenCalledOnce();
    expect(bumpDocVersion).not.toHaveBeenCalled();
  });

  it("routes undo and redo to the visible WYSIWYG history", () => {
    const editor = activateVisualEditor();
    insertAtCursor("\\alpha");
    expect(latexOf(editor)).toBe("Hello\\alpha\n");

    editorUndo();
    expect(latexOf(editor)).toBe("Hello\n");
    expect(core.editorUndo).not.toHaveBeenCalled();

    editorRedo();
    expect(latexOf(editor)).toBe("Hello\\alpha\n");
    expect(core.editorRedo).not.toHaveBeenCalled();
    expect(bumpDocVersion).not.toHaveBeenCalled();
  });
});
