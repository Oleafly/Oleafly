import type { EditorView } from "@codemirror/view";

const handlers = new WeakMap<EditorView, () => void>();

export function registerHostSave(view: EditorView, save: () => void): void {
  handlers.set(view, save);
}

export function unregisterHostSave(view: EditorView): void {
  handlers.delete(view);
}

export function runHostSave(view: EditorView): boolean {
  const save = handlers.get(view);
  if (!save) return false;
  save();
  return true;
}
