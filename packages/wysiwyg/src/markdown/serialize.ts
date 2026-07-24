import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { JSONContent } from "@tiptap/core";

export function serializeMarkdownBody(doc: JSONContent): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), Markdown],
    content: doc,
  });
  const markdown = editor.storage.markdown.getMarkdown();
  editor.destroy();
  return markdown;
}
