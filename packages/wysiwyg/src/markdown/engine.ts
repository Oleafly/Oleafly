import { createDocument, Editor } from "@tiptap/core";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const engines = new WeakMap<readonly AnyExtension[], Editor>();

export function markdownEngine(extensions: AnyExtension[]): Editor {
  let editor = engines.get(extensions);
  if (!editor || editor.isDestroyed) {
    editor = new Editor({ element: document.createElement("div"), extensions, content: "" });
    engines.set(extensions, editor);
  }
  return editor;
}

export function markdownToDoc(editor: Editor, markdown: string): JSONContent {
  const html: string = editor.storage.markdown.parser.parse(markdown);
  const { state } = editor;
  const parsed = createDocument(html, editor.schema);
  return state.apply(state.tr.replaceWith(0, state.doc.content.size, [parsed])).doc.toJSON();
}

export function markdownOfDoc(editor: Editor, doc: ProseMirrorNode): string {
  return editor.storage.markdown.serializer.serialize(doc);
}
