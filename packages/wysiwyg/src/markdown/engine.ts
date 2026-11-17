import { createDocument, Editor, type AnyExtension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const engines = new WeakMap<readonly AnyExtension[], Editor>();
let sourceParses = 0;
let markTagModelled = false;

export interface MarkdownParseContext {
  definitionLead: RegExp | null;
  tab: string | null;
}

let parseContext: MarkdownParseContext = { definitionLead: null, tab: null };

export function markdownParseContext(): MarkdownParseContext {
  return parseContext;
}

export function withMarkdownParseContext<T>(context: MarkdownParseContext, run: () => T): T {
  const outer = parseContext;
  parseContext = context;
  try {
    return run();
  } finally {
    parseContext = outer;
  }
}

export function parsingMarkdownSource(): boolean {
  return sourceParses > 0;
}

export function parsingWithMarkTag(): boolean {
  return markTagModelled;
}

function writesMarkTag(editor: Editor): boolean {
  const storage = (editor.storage as unknown as Record<string, { markdown?: { serialize?: { tags?: readonly string[] } } } | undefined>).highlight;
  return storage?.markdown?.serialize?.tags?.[0] === "<mark>";
}

export function markdownEngine(extensions: AnyExtension[]): Editor {
  let editor = engines.get(extensions);
  if (!editor || editor.isDestroyed) {
    editor = new Editor({ element: document.createElement("div"), extensions, content: "" });
    engines.set(extensions, editor);
  }
  return editor;
}

function asSourceParse<T>(editor: Editor, run: () => T): T {
  sourceParses++;
  const outer = markTagModelled;
  markTagModelled = writesMarkTag(editor);
  try {
    return run();
  } finally {
    sourceParses--;
    markTagModelled = outer;
  }
}

export function markdownTokens<T>(editor: Editor, markdown: string, env: object): T {
  return asSourceParse(editor, () => editor.storage.markdown.parser.md.parse(markdown, env) as unknown as T);
}

export function markdownToDoc(editor: Editor, markdown: string): JSONContent {
  const html: string = asSourceParse(editor, () => editor.storage.markdown.parser.parse(markdown));
  const { state } = editor;
  const parsed = createDocument(html, editor.schema);
  return state.apply(state.tr.replaceWith(0, state.doc.content.size, [parsed])).doc.toJSON();
}

export function markdownOfDoc(editor: Editor, doc: ProseMirrorNode): string {
  return editor.storage.markdown.serializer.serialize(doc);
}
