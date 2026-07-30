import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "../schema";

export function serializeMarkdownBody(doc: JSONContent): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: doc,
  });
  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return markdown;
}
