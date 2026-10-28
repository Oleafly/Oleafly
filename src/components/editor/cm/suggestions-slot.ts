import { Compartment, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";

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

export function suggestionsEditorSlot(): Extension {
  return [tracker, compartment.of(current)];
}

export function setSuggestionsEditorExtension(extension: Extension): () => void {
  current = extension;
  for (const view of views) view.dispatch({ effects: compartment.reconfigure(extension) });
  return () => {
    if (current === extension) setSuggestionsEditorExtension([]);
  };
}
