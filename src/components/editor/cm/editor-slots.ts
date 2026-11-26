import { Compartment, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";

interface EditorSlot {
  slot(): Extension;
  set(extension: Extension): () => void;
}

function editorSlot(): EditorSlot {
  const compartment = new Compartment();
  const views = new Set<EditorView>();
  let current: Extension = [];
  const tracker = ViewPlugin.define((view) => {
    views.add(view);
    return {
      destroy: () => {
        views.delete(view);
      },
    };
  });
  const set = (extension: Extension): (() => void) => {
    current = extension;
    for (const view of views) view.dispatch({ effects: compartment.reconfigure(extension) });
    return () => {
      if (current === extension) set([]);
    };
  };
  return { slot: () => [tracker, compartment.of(current)], set };
}

const collab = editorSlot();
const comments = editorSlot();
const suggestions = editorSlot();

export const collabEditorSlot = collab.slot;
export const setCollabEditorExtension = collab.set;
export const commentsEditorSlot = comments.slot;
export const setCommentsEditorExtension = comments.set;
export const suggestionsEditorSlot = suggestions.slot;
export const setSuggestionsEditorExtension = suggestions.set;
