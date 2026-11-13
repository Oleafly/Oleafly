import type { Editor } from "@tiptap/core";

const watchers = new WeakMap<Editor, Set<() => void>>();

export function watchEditable(editor: Editor, listener: () => void): () => void {
  let set = watchers.get(editor);
  if (!set) {
    set = new Set();
    watchers.set(editor, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function editableChanged(editor: Editor): void {
  for (const listener of Array.from(watchers.get(editor) ?? [])) listener();
}
