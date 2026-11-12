import { createMarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { Editor, type AnyExtension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { noteSourceOf } from "../note-live-doc";
import type { NoteViews } from "../note-markdown";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "../note-markdown";

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

export function kbNote(source: string, views: NoteViews | null = { callout: null }): { editor: Editor; save: () => string } {
  const parsed = parseNoteMarkdown(source);
  const editor = kbEditor(source, views);
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, editor.getJSON());
  return { editor, save: () => noteSourceOf(editor.state.doc, parsed.frontmatter, parsed.separator, snapshot) };
}

export function positionOf(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (found >= 0) return false;
    const index = node.isText ? (node.text ?? "").indexOf(needle) : -1;
    if (index >= 0) found = position + index;
    return found < 0;
  });
  if (found < 0) throw new Error(`no text ${needle}`);
  return found;
}

export function placeCursor(editor: Editor, text: string, offset = 0): number {
  const found = positionOf(editor, text) + offset;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)));
  return found;
}

export function selectText(editor: Editor, needle: string): void {
  const from = positionOf(editor, needle);
  editor.commands.setTextSelection({ from, to: from + needle.length });
}

export function typeBefore(editor: Editor, needle: string, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text, positionOf(editor, needle)));
}

export function deleteText(editor: Editor, needle: string): void {
  const from = positionOf(editor, needle);
  editor.view.dispatch(editor.state.tr.delete(from, from + needle.length));
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
