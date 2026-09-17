import {
  insertAtCursor as coreInsertAtCursor,
  wrapSelectionOrPlaceholder as coreWrapSelectionOrPlaceholder,
  insertTemplate as coreInsertTemplate,
  insertEnvironment as coreInsertEnvironment,
  editorUndo as coreEditorUndo,
  editorRedo as coreEditorRedo,
  editorVimUndo as coreEditorVimUndo,
  editorVimRedo as coreEditorVimRedo,
} from "@oleafly/editor";
import {
  getWysiwygDocumentContext,
  getWysiwygEditor,
  getWysiwygInsertions,
  isWysiwygActive,
} from "@/components/editor/wysiwyg/controller";

export {
  setEditorView,
  getEditorView,
  getCurrentLine,
  gotoLine,
  selectWordNearLine,
  gotoRange,
  replaceRange,
  wrapSelection,
  focusEditor,
  editorFind,
  waitForEditorDocument,
} from "@oleafly/editor";

function insertRawIntoWysiwyg(source: string, block: boolean): boolean {
  const editor = getWysiwygEditor();
  const insertions = getWysiwygInsertions();
  if (!editor || !insertions) return false;
  insertions.insertLatex(editor.view, source, block, getWysiwygDocumentContext().theoremEnvironments);
  return true;
}

function wysiwygSelectedText(): string {
  const editor = getWysiwygEditor();
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return from === to ? "" : editor.state.doc.textBetween(from, to, " ");
}

export function insertAtCursor(text: string) {
  if (isWysiwygActive() && insertRawIntoWysiwyg(text, text.includes("\n"))) return;
  coreInsertAtCursor(text);
}

export function insertText(text: string) {
  insertAtCursor(text);
}

export function wrapSelectionOrPlaceholder(before: string, after: string, placeholder: string) {
  if (isWysiwygActive()) {
    const selected = wysiwygSelectedText();
    const content = selected.trim() === "" ? placeholder : selected;
    if (insertRawIntoWysiwyg(`${before}${content}${after}`, false)) return;
  }
  coreWrapSelectionOrPlaceholder(before, after, placeholder);
}

export function insertTemplate(template: string, selStart: number, selEnd: number) {
  if (isWysiwygActive() && insertRawIntoWysiwyg(template, template.includes("\n"))) return;
  coreInsertTemplate(template, selStart, selEnd);
}

export function insertEnvironment(name: string) {
  if (isWysiwygActive()) {
    const template = `\\begin{${name}}\n  \n\\end{${name}}\n`;
    if (insertRawIntoWysiwyg(template, true)) return;
  }
  coreInsertEnvironment(name);
}

export function editorUndo() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().undo().run();
      return;
    }
  }
  coreEditorUndo();
}

export function editorRedo() {
  if (isWysiwygActive()) {
    const editor = getWysiwygEditor();
    if (editor) {
      editor.chain().focus().redo().run();
      return;
    }
  }
  coreEditorRedo();
}

/** Returns whether the active source editor accepted the Vim history command. */
export function editorVimUndo(): boolean {
  if (isWysiwygActive()) return false;
  return coreEditorVimUndo();
}

/** Returns whether the active source editor accepted the Vim history command. */
export function editorVimRedo(): boolean {
  if (isWysiwygActive()) return false;
  return coreEditorVimRedo();
}
