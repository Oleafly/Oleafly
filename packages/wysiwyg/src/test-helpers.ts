import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";

export function createHeadlessEditor(): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: "",
  });
}
