// Thin app shim: the editor controller lives in @openleaf/editor.
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
} from "@openleaf/editor";
