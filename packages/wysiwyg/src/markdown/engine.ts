import { createDocument, Editor, type AnyExtension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const engines = new WeakMap<readonly AnyExtension[], Editor>();
let sourceParses = 0;
let markTagModelled = false;

export function parsingMarkdownSource(): boolean {
  return sourceParses > 0;
}

export function parsingWithMarkTag(): boolean {
  return markTagModelled;
}

function writesMarkTag(editor: Editor): boolean {
  const storage = (editor.storage as unknown as Record<string, { markdown?: { serialize?: { open?: unknown } } } | undefined>).highlight;
  return storage?.markdown?.serialize?.open === "<mark>";
}

export function markdownEngine(extensions: AnyExtension[]): Editor {
  let editor = engines.get(extensions);
  if (!editor || editor.isDestroyed) {
    editor = new Editor({ element: document.createElement("div"), extensions, content: "" });
    engines.set(extensions, editor);
  }
  return editor;
}

export function markdownToDoc(editor: Editor, markdown: string): JSONContent {
  sourceParses++;
  const outer = markTagModelled;
  markTagModelled = writesMarkTag(editor);
  let html: string;
  try {
    html = editor.storage.markdown.parser.parse(markdown);
  } finally {
    sourceParses--;
    markTagModelled = outer;
  }
  const { state } = editor;
  const parsed = createDocument(html, editor.schema);
  return state.apply(state.tr.replaceWith(0, state.doc.content.size, [parsed])).doc.toJSON();
}

export function markdownOfDoc(editor: Editor, doc: ProseMirrorNode): string {
  return editor.storage.markdown.serializer.serialize(doc);
}
