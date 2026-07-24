import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { JSONContent } from "@tiptap/core";

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/;

export function parseMarkdownBody(source: string): { doc: JSONContent; frontmatter: string } {
  const match = FRONTMATTER_RE.exec(source);
  const frontmatter = match ? match[1] : "";
  const body = match ? source.slice(match[0].length) : source;

  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), Markdown],
    content: "",
  });
  editor.commands.setContent(body);
  const doc = editor.getJSON();
  editor.destroy();

  return { doc, frontmatter };
}
