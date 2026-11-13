import { createDocument, type AnyExtension, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { markdownEngine, markdownOfDoc } from "./engine";
import {
  serializeWithSourceLayout,
  type MarkdownSourceSnapshot,
} from "./source-layout";

const blockKeys = new WeakMap<ProseMirrorNode, string>();

export function markdownBlockKey(node: ProseMirrorNode): string {
  let key = blockKeys.get(node);
  if (key === undefined) {
    key = JSON.stringify(node.toJSON());
    blockKeys.set(node, key);
  }
  return key;
}

function blocksOf(doc: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  doc.forEach((block) => {
    blocks.push(block);
  });
  return blocks;
}

export function serializeMarkdownDoc(
  doc: ProseMirrorNode,
  snapshot: MarkdownSourceSnapshot | null = null,
  extensions: AnyExtension[] = WYSIWYG_EXTENSIONS,
): string {
  const editor = markdownEngine(extensions);
  if (!snapshot) return markdownOfDoc(editor, doc);
  return serializeWithSourceLayout(
    { content: blocksOf(doc) },
    snapshot,
    (nodes) => markdownOfDoc(editor, doc.type.create(null, nodes)),
    markdownBlockKey,
  );
}

export function serializeMarkdownBody(
  doc: JSONContent,
  snapshot: MarkdownSourceSnapshot | null = null,
  extensions: AnyExtension[] = WYSIWYG_EXTENSIONS,
): string {
  const editor = markdownEngine(extensions);
  if (!snapshot) return markdownOfDoc(editor, createDocument(doc, editor.schema) as ProseMirrorNode);
  return serializeWithSourceLayout(doc, snapshot, (nodes) =>
    markdownOfDoc(editor, editor.schema.nodeFromJSON({ type: "doc", content: nodes })),
  );
}
