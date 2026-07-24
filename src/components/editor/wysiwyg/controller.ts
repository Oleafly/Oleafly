import type { Editor } from "@tiptap/react";

let editor: Editor | null = null;
let visible = false;

export function setWysiwygEditor(e: Editor | null) {
  editor = e;
}

export function getWysiwygEditor(): Editor | null {
  return editor;
}

export function setWysiwygVisible(v: boolean) {
  visible = v;
}

export function isWysiwygActive(): boolean {
  return visible && editor != null;
}
