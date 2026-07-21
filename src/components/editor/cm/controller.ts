// Thin app shim: the editor controller lives in @oleafly/editor.
export {
  setEditorView,
  getEditorView,
  getCurrentLine,
  gotoLine,
  selectWordNearLine,
  gotoRange,
  insertAtCursor,
  replaceRange,
  wrapSelection,
  focusEditor,
  editorUndo,
  editorRedo,
  editorFind,
  insertText,
} from "@oleafly/editor";
