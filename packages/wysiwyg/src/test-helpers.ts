import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

export function createHeadlessEditor(): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), Markdown],
    content: "",
  });
}
