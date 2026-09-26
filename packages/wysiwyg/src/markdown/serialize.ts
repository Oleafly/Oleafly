import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "../schema";
import {
  serializeWithSourceLayout,
  type MarkdownSourceSnapshot,
} from "./source-layout";

export function serializeMarkdownBody(
  doc: JSONContent,
  snapshot: MarkdownSourceSnapshot | null = null,
): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: snapshot ? "" : doc,
  });
  const { serializer } = editor.storage.markdown;
  const markdown = snapshot
    ? serializeWithSourceLayout(doc, snapshot, (nodes) =>
        serializer.serialize(editor.schema.nodeFromJSON({ type: "doc", content: nodes })),
      )
    : editor.storage.markdown.getMarkdown();
  editor.destroy();
  return markdown;
}
