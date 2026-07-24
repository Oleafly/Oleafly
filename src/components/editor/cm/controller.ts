import {
  setEditorView,
  getEditorView,
  getCurrentLine,
  gotoLine,
  selectWordNearLine,
  gotoRange,
  insertAtCursor as coreInsertAtCursor,
  replaceRange,
  wrapSelection,
  wrapSelectionOrPlaceholder as coreWrapSelectionOrPlaceholder,
  insertTemplate as coreInsertTemplate,
  insertEnvironment as coreInsertEnvironment,
  focusEditor,
  editorUndo as coreEditorUndo,
  editorRedo as coreEditorRedo,
  editorFind,
} from "@oleafly/editor";
import { useFilesStore } from "@/store/files";
import { getWysiwygEditor, isWysiwygActive } from "@/components/editor/wysiwyg/controller";

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
};

function insertRawIntoWysiwyg(source: string, block: boolean): boolean {
  const editor = getWysiwygEditor();
  if (!editor) return false;
  editor
    .chain()
    .focus()
    .insertContent({ type: block ? "rawBlock" : "rawInline", attrs: { source } })
    .run();
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
  if (isWysiwygActive() && insertRawIntoWysiwyg(`${before}${placeholder}${after}`, false)) return;
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
  coreEditorUndo();
  useFilesStore.getState().bumpDocVersion();
}

export function editorRedo() {
  coreEditorRedo();
  useFilesStore.getState().bumpDocVersion();
}
