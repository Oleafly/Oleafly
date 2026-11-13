import { Editor } from "@tiptap/core";
import { parseMarkdownBody, type ParseMarkdownBodyOptions } from "./markdown/parse";
import { serializeMarkdownBody } from "./markdown/serialize";
import { createMarkdownSourceSnapshot } from "./markdown/source-layout";
import { WYSIWYG_EXTENSIONS } from "./schema";

const opened: Editor[] = [];

export function createHeadlessEditor(): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: "",
  });
}

export function openMarkdown(
  source: string,
  options: ParseMarkdownBodyOptions = {},
): { editor: Editor; save: () => string } {
  const { doc, frontmatter, layout } = parseMarkdownBody(source, options);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: options.extensions ?? WYSIWYG_EXTENSIONS,
    content: doc,
  });
  opened.push(editor);
  const snapshot = createMarkdownSourceSnapshot(layout, editor.getJSON());
  return {
    editor,
    save: () => frontmatter + serializeMarkdownBody(editor.getJSON(), snapshot, options.extensions),
  };
}

export function destroyOpenedEditors(): void {
  for (const editor of opened.splice(0)) editor.destroy();
}

export function positionAfter(editor: Editor, needle: string): number {
  let at = -1;
  editor.state.doc.descendants((node, position) => {
    if (at < 0 && node.isText && node.text?.includes(needle)) {
      at = position + node.text.indexOf(needle) + needle.length;
    }
  });
  if (at < 0) throw new Error(`no text ${needle}`);
  return at;
}

export function typeAtEndOf(editor: Editor, needle: string, text: string): void {
  editor.view.dispatch(editor.state.tr.insertText(text, positionAfter(editor, needle)));
}

export function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const typed = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
    );
    if (!typed) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
