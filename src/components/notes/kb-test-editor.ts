import { Editor, type AnyExtension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { NoteViews } from "./note-markdown";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";

const editors: Editor[] = [];

export function kbEditor(markdown: string, views: NoteViews | null = { callout: null }, extra: AnyExtension[] = []): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...noteBaseExtensions({}, views), ...extra],
    content: parseNoteMarkdown(markdown).doc,
  });
  editors.push(editor);
  return editor;
}

export function destroyKbEditors(): void {
  for (const editor of editors.splice(0)) {
    if (editor.isDestroyed) continue;
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
}

export function kbMarkdown(editor: Editor): string {
  return serializeNoteMarkdown(editor.getJSON());
}

export function placeCursor(editor: Editor, text: string, offset = 0): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const at = (node.text ?? "").indexOf(text);
    if (at >= 0) found = pos + at + offset;
    return false;
  });
  if (found < 0) throw new Error(`no text ${text}`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)));
  return found;
}

export function typeInto(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}

export function pressKey(editor: Editor, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  return editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event)) ?? false;
}
