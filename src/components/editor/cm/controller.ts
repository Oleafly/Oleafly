import {
  insertAtCursor as coreInsertAtCursor,
  wrapSelectionOrPlaceholder as coreWrapSelectionOrPlaceholder,
  insertTemplate as coreInsertTemplate,
  insertEnvironment as coreInsertEnvironment,
  insertListEnvironment as coreInsertListEnvironment,
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

export function insertAtCursor(text: string) {
  if (isWysiwygActive() && insertRawIntoWysiwyg(text, text.includes("\n"))) return;
  coreInsertAtCursor(text);
}

export function insertText(text: string) {
  insertAtCursor(text);
}

export function wrapSelectionOrPlaceholder(before: string, after: string, placeholder: string) {
  coreWrapSelectionOrPlaceholder(before, after, placeholder);
}

export function insertTemplate(template: string, selStart: number, selEnd: number) {
  coreInsertTemplate(template, selStart, selEnd);
}

export function insertEnvironment(name: string) {
  coreInsertEnvironment(name);
}

export function insertListEnvironment(name: string) {
  coreInsertListEnvironment(name);
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
